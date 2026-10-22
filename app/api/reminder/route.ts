import { type NextRequest, NextResponse } from "next/server";
import { currentWeek } from "@/lib/config";
import { requirePermission, schoolIdFor } from "@/lib/server/auth/guard";
import { loadCalendarAnchors } from "@/lib/server/calendar";
import { adminDb } from "@/lib/server/db";
import { resolveSession } from "@/lib/server/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/reminder — nudge the teachers a supervisor has not finished.
 *
 * Previously both "Hantar peringatan" buttons printed a toast saying three
 * reminders had been sent, and sent nothing: the table had rows, a bell, a
 * reader and no writer. A Guru Besar pressing it was told their staff had been
 * reminded while the staff heard nothing at all.
 *
 * Gated on `pantau`, like the roster that decides who is late. Scope is not
 * applied here: this handler holds the secret key, so `erph.remind_teachers`
 * filters its targets through `erph.may_supervise` — the same predicate
 * `pantau_teachers` uses — and an id outside the caller's scope simply does
 * not match. Left to the handler instead, one careless edit would let a GPK
 * nudge every teacher in the district.
 *
 * `targets` is optional. Absent, every supervised teacher who is late is
 * reminded; present, only those — still scope-checked on the server.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePermission(request, "pantau");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ notified: 0 });

  let body: { targets?: unknown };
  try {
    body = (await request.json()) as { targets?: unknown };
  } catch {
    // A body is optional here: no body means "everyone late", which is what
    // the school-wide button asks for.
    body = {};
  }

  const raw = Array.isArray(body.targets) ? body.targets : null;
  const targets =
    raw === null ? null : raw.filter((t): t is string => typeof t === "string" && UUID.test(t));

  // A supplied list that survives validation as nothing must not fall back to
  // "everyone late". That widens scope at exactly the moment the caller has
  // demonstrated they cannot be trusted to name a valid target — and the
  // teacher-side failure mode is a school-wide nag, not a missed one.
  if (raw !== null && targets !== null && targets.length === 0) {
    return NextResponse.json({ error: "Sasaran peringatan tidak sah." }, { status: 400 });
  }

  // Who counts as late is a question about a *week*, so it is the school's own
  // numbering — a nudge that used the term-start grid while the teacher's
  // dashboard showed a declared one would chase the wrong Friday.
  const anchors = await loadCalendarAnchors(schoolId);
  const { data, error } = await adminDb(gate.user.id).rpc("remind_teachers", {
    p_school: schoolId,
    p_session: await resolveSession(gate.user.id),
    p_week: currentWeek(new Date(), anchors),
    p_targets: targets,
  });

  if (error) {
    console.error("[reminder] failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa menghantar peringatan." },
      { status: 500 },
    );
  }

  // The count comes from the insert, not from the request. Reporting the
  // caller's own list length back at them would make a button that nudged
  // nobody still claim success.
  return NextResponse.json({ notified: data ?? 0 });
}
