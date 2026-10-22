import { type NextRequest, NextResponse } from "next/server";
import { requireDbUser, schoolIdFor } from "@/lib/server/auth/guard";

/**
 * GET /api/calendar — the weeks this school's administrator has declared.
 *
 * Every screen that asks "what week is it" needs the answer from the database
 * once a calendar override exists: the breadcrumb, the week picker, the
 * dashboard's deadline and the archive all run on `currentWeek()`, which is
 * automatic until someone declares otherwise. So this is deliberately *not*
 * administrator-only — the people who must not set the calendar are exactly
 * the people whose pages have to read it.
 *
 * Scoped to the caller's own school, because an anchor from another one would
 * quietly renumber this deployment's whole dashboard.
 *
 * An empty list is a complete answer, not a failure: local mode, a fresh
 * deployment and a school that has never overridden anything all produce it,
 * and the client numbers weeks from the term start in every one of those cases.
 * This route only runs in synced mode — `requireDbUser` answers 503 locally,
 * which is why the client treats a failed load as "no declarations" rather
 * than as a reason to stop rendering.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ anchors: [] });

  const { data: setting, error: settingError } = await gate.db
    .from("school_setting")
    .select("current_session")
    .eq("school_id", schoolId)
    .maybeSingle();
  if (settingError) {
    console.error("[calendar] session read failed:", settingError.message);
    return NextResponse.json(
      { error: "Kalendar minggu tidak dapat dimuatkan." },
      { status: 500 },
    );
  }

  const session = (setting as { current_session: string } | null)?.current_session;
  if (!session) return NextResponse.json({ anchors: [] });

  const { data, error } = await gate.db
    .from("academic_calendar")
    .select("session, week_no, start_date, end_date, label")
    .eq("school_id", schoolId)
    .eq("session", session)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("[calendar] read failed:", error.message);
    return NextResponse.json(
      { error: "Kalendar minggu tidak dapat dimuatkan." },
      { status: 500 },
    );
  }
  return NextResponse.json({ anchors: data ?? [] });
}
