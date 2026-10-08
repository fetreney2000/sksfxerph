import { type NextRequest, NextResponse } from "next/server";
import { reviewStageFor } from "@/lib/auth/permissions";
import { requireReviewer } from "@/lib/server/auth/guard";

/**
 * POST /api/rpc/review — grade the plan this reviewer's stage holds.
 *
 * GPK and Guru Besar only, enforced *before* the RPC as well as inside it
 * (defence in depth: each SQL function re-checks its own role *and* its own
 * starting status). Which function runs is derived from the role, never from
 * the request, so a caller cannot pick its own rung of the chain.
 * KPM Lampiran 7: grade 1 = lengkap, 0 = tidak lengkap.
 */
export async function POST(request: NextRequest) {
  const gate = await requireReviewer(request);
  if ("error" in gate) return gate.error;

  const stage = reviewStageFor(gate.user.role);
  if (!stage) {
    return NextResponse.json({ error: "Peranan penyemak diperlukan" }, { status: 403 });
  }

  let body: { documentId?: string; grade?: number; comment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  if (!body.documentId || (body.grade !== 0 && body.grade !== 1)) {
    return NextResponse.json(
      { error: "documentId dan gred (0|1) diperlukan" },
      { status: 400 },
    );
  }

  const { data, error } = await gate.db.rpc(stage.rpc, {
    p_document: body.documentId,
    p_grade: body.grade,
    p_comment: body.comment ?? null,
  });

  if (error) {
    console.error("[review] rpc failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json(data);
}
