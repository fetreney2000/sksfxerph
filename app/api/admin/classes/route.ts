import { type NextRequest, NextResponse } from "next/server";
import { SESSION } from "@/lib/config";
import { requireAdministrator, schoolIdFor } from "@/lib/server/auth/guard";

/**
 * GET /api/admin/classes — every class in the current session, archived ones
 * included, with the plan count each one carries.
 *
 * Split from `GET /api/classes` on purpose: that endpoint is the editor's view
 * (active only, any member), this one is the administrator's (all of them, plus
 * `doc_count` so "archive this class" can be explained rather than guessed —
 * the count is what tells an admin how many plans the action touches).
 *
 * Writes live on `/api/classes` alongside the read the editor uses, so both go
 * through the same `erph.admin_set_class` gate.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [], session: SESSION });

  const { data: setting } = await gate.db
    .from("school_setting")
    .select("current_session")
    .eq("school_id", schoolId)
    .maybeSingle();

  const session = (setting as { current_session: string } | null)?.current_session ?? SESSION;

  const { data, error } = await gate.db.rpc("admin_list_classes", {
    p_school: schoolId,
    p_session: session,
  });

  if (error) {
    console.error("[admin] list classes failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil senarai kelas." },
      { status: 500 },
    );
  }

  return NextResponse.json({ items: data ?? [], session });
}
