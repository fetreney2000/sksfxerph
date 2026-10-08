import { type NextRequest, NextResponse } from "next/server";
import { currentWeek, SESSION } from "@/lib/config";
import { requireDbUser, schoolIdFor } from "@/lib/server/auth/guard";

/**
 * GET /api/stats — school compliance for the current week.
 *
 * Wraps the `erph.school_week_stats` SECURITY DEFINER RPC. The RPC re-checks
 * membership with `erph.actor()`, so a teacher cannot read another school's
 * figures even though this handler holds the secret key.
 *
 * 503 in local mode — the caller falls back to the bundled demo figures.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ error: "Tiada keahlian sekolah aktif" }, { status: 403 });
  }

  const { data, error } = await gate.db.rpc("school_week_stats", {
    p_school: schoolId,
    p_session: SESSION,
    p_week: currentWeek(),
  });

  if (error) {
    console.error("[stats] rpc failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json({ stats: (data ?? [])[0] ?? null });
}
