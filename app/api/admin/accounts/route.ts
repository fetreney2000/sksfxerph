import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator, schoolIdFor } from "@/lib/server/auth/guard";
import { hashPassword } from "@/lib/server/auth/password";
import { MEMBER_ROLES } from "@/lib/types";

/**
 * GET / POST / PATCH /api/admin/accounts — who may use the app, and as what.
 *
 * Reads and writes go through `erph.admin_list_members` /
 * `erph.admin_create_member` / `erph.admin_set_member` rather than PostgREST,
 * for two reasons: every handler holds the secret key and so bypasses RLS
 * entirely, and the role is duplicated on `erph.user` (what the route guard
 * reads) and `erph.school_member` (what SQL reads) — updating one alone would
 * leave a demoted account privileged through whichever layer it reached next.
 *
 * POST mints the scrypt hash here, never in SQL: a `security definer` function
 * is readable by anyone with SELECT on `pg_proc`, and there is no reason for a
 * password — even a hashed one — to be produced by the database.
 */

/** Roles an administrator may hand out — `system` is a service account. */
const ASSIGNABLE = MEMBER_ROLES.filter((r) => r !== "system");

const postSchema = z.object({
  username: z
    .string()
    .min(3, "Nama pengguna: sekurang-kurangnya 3 aksara")
    .max(32, "Nama pengguna: maksimum 32 aksara"),
  fullName: z.string().min(1, "Nama penuh diperlukan").max(120),
  role: z.enum(ASSIGNABLE, { message: "Peranan tidak sah" }),
  email: z.string().email("Emel tidak sah").max(200).nullable().optional(),
  password: z.string().min(8, "Kata laluan: sekurang-kurangnya 8 aksara").max(128),
});

/**
 * Four distinct actions in one PATCH. `password` and `unlock` are separate
 * from `role`/`isActive` because they hit different RPCs — and resetting a
 * password already clears the lockout, so the two are never sent together.
 * `supervisorId` is separate again: it is the scope assignment that decides
 * which plans a GPK can reach, and it has its own validation in SQL (a
 * supervisor must be an active GPK or Guru Besar, and nobody supervises
 * themselves).
 */
const patchSchema = z
  .object({
    userId: z.string().uuid(),
    role: z.enum(ASSIGNABLE).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8, "Kata laluan: sekurang-kurangnya 8 aksara").max(128).optional(),
    unlock: z.literal(true).optional(),
    /** null clears it — the teacher falls back to Guru-Besar-only visibility. */
    supervisorId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (d) =>
      d.password !== undefined ||
      d.unlock !== undefined ||
      d.supervisorId !== undefined ||
      (d.role !== undefined && d.isActive !== undefined),
    { message: "Tiada perubahan diminta" },
  );

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] });

  const { data, error } = await gate.db.rpc("admin_list_members", { p_school: schoolId });
  if (error) {
    console.error("[admin] list members failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil akaun." },
      { status: 500 },
    );
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }

  const hash = await hashPassword(parsed.data.password);
  const { data, error } = await gate.db.rpc("admin_create_member", {
    p_school: schoolId,
    p_username: parsed.data.username,
    p_full_name: parsed.data.fullName,
    p_role: parsed.data.role,
    p_password_hash: hash,
    p_email: parsed.data.email ?? null,
  });

  // 23505 is the unique index doing its job when two admins race on a name —
  // surfaced as text rather than a Postgres code, because nobody reading the
  // UI knows what 23505 means.
  if (error) {
    const message =
      error.code === "23505" || /telah digunakan/i.test(error.message)
        ? "Nama pengguna ini telah digunakan."
        : error.message;
    console.error("[admin] create member failed:", error.message);
    return NextResponse.json({ error: message }, { status: 422 });
  }

  return NextResponse.json({ ok: true, userId: data });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }
  const body = parsed.data;

  // The school must never be left with nobody who can put it back. Password
  // and unlock are exempt: changing your own password locks nobody out.
  const changesRole = body.role !== undefined && body.role !== gate.user.role;
  const deactivates = body.isActive === false;
  if (body.userId === gate.user.id && (changesRole || deactivates)) {
    return NextResponse.json(
      { error: "Anda tidak boleh mengubah peranan atau status akaun sendiri." },
      { status: 409 },
    );
  }

  let rpc: string;
  let args: Record<string, unknown>;

  if (body.password !== undefined) {
    // Hash in Node, and note in the response that this logged every device out —
    // the administrator needs to be able to tell the teacher that.
    rpc = "admin_reset_password";
    args = {
      p_school: schoolId,
      p_user: body.userId,
      p_password_hash: await hashPassword(body.password),
    };
  } else if (body.unlock) {
    rpc = "admin_unlock_member";
    args = { p_school: schoolId, p_user: body.userId };
  } else if (body.supervisorId !== undefined) {
    rpc = "admin_set_supervisor";
    args = {
      p_school: schoolId,
      p_member: body.userId,
      p_supervisor: body.supervisorId,
    };
  } else {
    rpc = "admin_set_member";
    args = {
      p_school: schoolId,
      p_user: body.userId,
      p_role: body.role,
      p_active: body.isActive,
    };
  }

  const { error } = await gate.db.rpc(rpc, args);
  if (error) {
    console.error(`[admin] ${rpc} failed:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
