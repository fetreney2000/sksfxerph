import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SESSION } from "@/lib/config";
import { requireAdministrator, requireDbUser, schoolIdFor } from "@/lib/server/auth/guard";
import type { adminDb } from "@/lib/server/db";

/**
 * GET / POST / PATCH /api/classes — the school's classes for one session.
 *
 * Two callers with different rights:
 *
 *   • any member (GET) — the editor, the dashboard's "RPH baharu" and the
 *     command palette all need the list before a plan can exist. Local mode
 *     never calls this: `lib/demo/seed.ts` supplies the fixtures instead.
 *   • the administrator (POST/PATCH) — `erph.admin_set_class` re-checks
 *     `has_role(..., 'pentadbir')` inside the function, because this handler
 *     holds the secret key and RLS would not stop it.
 *
 * This endpoint is what makes class management real. The editor previously read
 * `CLASSES` from the demo seed even in synced mode, so a plan created against
 * `c-5a` reached `sync_rph` and was rejected — that id is not a UUID.
 */

const createSchema = z.object({
  nama: z.string().min(1, "Nama kelas diperlukan").max(60),
  tahun: z.number().int().min(1).max(6).nullable().optional(),
  session: z.string().regex(/^\d{4}\/\d{4}$/, "Sesi mesti dalam bentuk TTTT/TTTT"),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  nama: z.string().min(1, "Nama kelas diperlukan").max(60),
  tahun: z.number().int().min(1).max(6).nullable().optional(),
  session: z.string().regex(/^\d{4}\/\d{4}$/, "Sesi mesti dalam bentuk TTTT/TTTT"),
  isActive: z.boolean(),
});

/** Any signed-in member: this is the editor's own reference data. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [], session: SESSION });

  // The session has to be read *before* the class query — they were once issued
  // in the same Promise.all, which made the filter read a variable that had not
  // resolved yet and quietly fall back to the build-time constant.
  const { data: setting } = await gate.db
    .from("school_setting")
    .select("current_session")
    .eq("school_id", schoolId)
    .maybeSingle();

  const session = (setting as { current_session: string } | null)?.current_session ?? SESSION;

  const { data: rows, error } = await gate.db
    .from("class")
    .select("id, nama, tahun, tingkatan, session, is_active")
    .eq("school_id", schoolId)
    .eq("session", session)
    .eq("is_active", true)
    .order("nama");

  if (error) {
    console.error("[classes] list failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil senarai kelas." },
      { status: 500 },
    );
  }

  return NextResponse.json({ items: rows ?? [], session });
}

/**
 * Administrator + school, or the response to send back. See the same helper in
 * `app/api/admin/subjects/route.ts` for why the two arms must not both mention
 * `error`.
 */
type AdminGate = { error: NextResponse } | { db: ReturnType<typeof adminDb>; schoolId: string };

async function adminGate(request: NextRequest): Promise<AdminGate> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return { error: gate.error };
  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return { error: NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 }) };
  }
  return { db: gate.db, schoolId };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await adminGate(request);
  if ("error" in gate) return gate.error;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }

  const { data, error } = await gate.db.rpc("admin_set_class", {
    p_school: gate.schoolId,
    p_id: null,
    p_nama: parsed.data.nama,
    p_tahun: parsed.data.tahun ?? null,
    p_session: parsed.data.session,
    p_active: true,
  });
  if (error) {
    console.error("[classes] create failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true, id: data });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const gate = await adminGate(request);
  if ("error" in gate) return gate.error;

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

  const { error } = await gate.db.rpc("admin_set_class", {
    p_school: gate.schoolId,
    p_id: parsed.data.id,
    p_nama: parsed.data.nama,
    p_tahun: parsed.data.tahun ?? null,
    p_session: parsed.data.session,
    p_active: parsed.data.isActive,
  });
  if (error) {
    console.error("[classes] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
