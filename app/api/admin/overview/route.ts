import { type NextRequest, NextResponse } from "next/server";
import { currentWeek } from "@/lib/config";
import { requireAdministrator, schoolIdFor } from "@/lib/server/auth/guard";
import { resolveSession } from "@/lib/server/session";

/**
 * GET /api/admin/overview — what an administrator is accountable for.
 *
 * One request rather than four, because this is a dashboard's first paint: the
 * counts are cheap individually but a card that pops in one at a time reads as
 * a slower app than it is.
 *
 * Role counts come from `admin_list_members` (which already re-checks
 * `has_role(..., 'pentadbir')` inside SQL) rather than a raw read of
 * `school_member`, so this endpoint inherits the same guarantee as the accounts
 * table it summarises. The week figures come from `school_week_stats`, the same
 * aggregate `/api/stats` serves — deliberately counts and a percentage, never a
 * name, so nothing here can become a back door around `/sekolah`.
 */
export interface Overview {
  members: { total: number; teachers: number; byRole: Record<string, number> };
  classes: number;
  subjects: number;
  templates: number;
  week: {
    expected: number;
    submitted: number;
    approved: number;
    compliance: number | null;
    returned_t: number;
    drafts: number;
  } | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ overview: null });

  const session = await resolveSession(gate.user.id);

  const [members, classes, subjects, templates, stats] = await Promise.all([
    gate.db.rpc("admin_list_members", { p_school: schoolId }),
    gate.db
      .from("class")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId)
      .eq("session", session),
    gate.db
      .from("subject")
      .select("code", { count: "exact", head: true })
      .eq("is_active", true),
    gate.db
      .from("rph_template")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId),
    gate.db.rpc("school_week_stats", {
      p_school: schoolId,
      p_session: session,
      p_week: currentWeek(),
    }),
  ]);

  if (members.error) {
    console.error("[admin] overview members failed:", members.error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil ringkasan." },
      { status: 500 },
    );
  }

  const rows = (members.data ?? []) as { role: string; is_active: boolean }[];
  const byRole: Record<string, number> = {};
  for (const r of rows) byRole[r.role] = (byRole[r.role] ?? 0) + 1;

  // "Registered teachers" excludes the Administrator and the service account:
  // they hold no `rph`, so counting them as staff would inflate the number an
  // administrator is judged against.
  const teachers = rows.filter(
    (r) => r.is_active && r.role !== "pentadbir" && r.role !== "system",
  ).length;

  const week = (stats.data ?? [])[0] ?? null;

  const overview: Overview = {
    members: { total: rows.length, teachers, byRole },
    classes: classes.count ?? 0,
    subjects: subjects.count ?? 0,
    templates: templates.count ?? 0,
    week: week
      ? {
          expected: week.expected ?? 0,
          submitted: week.submitted ?? 0,
          approved: week.approved ?? 0,
          compliance: week.compliance ?? null,
          returned_t: week.returned_t ?? 0,
          drafts: week.drafts ?? 0,
        }
      : null,
  };

  return NextResponse.json({ overview });
}
