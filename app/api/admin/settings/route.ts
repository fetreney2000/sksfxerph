import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator, schoolIdFor } from "@/lib/server/auth/guard";

/**
 * GET / PATCH /api/admin/settings — the school's term and submission rule.
 *
 * Reading is an ordinary member-scoped query (`setting_read` lets any member
 * see the school's own settings); writing goes through
 * `erph.admin_set_setting`, because a handler holding the secret key is not
 * stopped by RLS and the rule belongs to the administrator alone.
 */
const patchSchema = z.object({
  submitWeekday: z.number().int().min(1).max(7),
  submitTime: z.string().regex(/^\d{2}:\d{2}$/),
  requireComplete: z.boolean(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ setting: null, school: null });

  const [{ data: setting }, { data: school }] = await Promise.all([
    gate.db
      .from("school_setting")
      .select("current_session, submit_weekday, submit_time, require_complete")
      .eq("school_id", schoolId)
      .maybeSingle(),
    gate.db
      .from("school")
      .select("id, kod_sekolah, nama, level, ppd, jpn")
      .eq("id", schoolId)
      .maybeSingle(),
  ]);
  return NextResponse.json({ setting: setting ?? null, school: school ?? null });
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

  const { error } = await gate.db.rpc("admin_set_setting", {
    p_school: schoolId,
    p_weekday: parsed.data.submitWeekday,
    p_time: parsed.data.submitTime,
    p_require_complete: parsed.data.requireComplete,
  });
  if (error) {
    console.error("[admin] set setting failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
