import { type NextRequest, NextResponse } from "next/server";
import { requireDbUser } from "@/lib/server/auth/guard";

/**
 * GET /api/subjects — the subjects the editor may offer.
 *
 * Any signed-in member: this is the teacher's own reference data, the same way
 * `/api/classes` is. Local mode never calls it — `lib/demo/seed.ts` supplies
 * three fixtures instead, which is what keeps the offline editor working.
 *
 * `is_active` is the whole point of the filter: an administrator who switches a
 * subject off removes it from this list, and with it from every teacher's
 * picker, without deleting a single plan already written against it.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  const { data, error } = await gate.db
    .from("subject")
    .select("code, nama, curriculum, is_active")
    .eq("is_active", true)
    .order("nama");

  if (error) {
    console.error("[subjects] list failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil mata pelajaran." },
      { status: 500 },
    );
  }
  return NextResponse.json({ items: data ?? [] });
}
