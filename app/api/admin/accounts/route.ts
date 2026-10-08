import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator, schoolIdFor } from "@/lib/server/auth/guard";
import { MEMBER_ROLES } from "@/lib/types";

/**
 * GET / PATCH /api/admin/accounts — who may use the app, and as what.
 *
 * Reads and writes go through `erph.admin_list_members` /
 * `erph.admin_set_member` rather than PostgREST, for two reasons: every
 * handler holds the secret key and so bypasses RLS entirely, and the role is
 * duplicated on `erph.user` (what the route guard reads) and
 * `erph.school_member` (what SQL reads) — updating one alone would leave a
 * demoted account privileged through whichever layer it reached next.
 */
const patchSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(MEMBER_ROLES),
  isActive: z.boolean(),
});

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
      { error: "Data tidak sah", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // The school must never be left with nobody who can put it back.
  if (
    parsed.data.userId === gate.user.id &&
    (parsed.data.role !== gate.user.role || !parsed.data.isActive)
  ) {
    return NextResponse.json(
      { error: "Anda tidak boleh mengubah peranan atau status akaun sendiri." },
      { status: 409 },
    );
  }

  const { error } = await gate.db.rpc("admin_set_member", {
    p_school: schoolId,
    p_user: parsed.data.userId,
    p_role: parsed.data.role,
    p_active: parsed.data.isActive,
  });
  if (error) {
    console.error("[admin] set member failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
