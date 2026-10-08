import { type NextRequest, NextResponse } from "next/server";
import { requireReviewer } from "@/lib/server/auth/guard";

/**
 * POST /api/rpc/review — grade a plan (`erph.review_rph`).
 *
 * Admin/coordinator only, enforced *before* the RPC as well as inside it
 * (defence in depth: the RPC re-checks the reviewer role in SQL).
 * KPM Lampiran 7: grade 1 = lengkap, 0 = tidak lengkap.
 */
export async function POST(request: NextRequest) {
  const gate = await requireReviewer(request);
  if ("error" in gate) return gate.error;

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

  const { data, error } = await gate.db.rpc("review_rph", {
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
