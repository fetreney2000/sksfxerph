import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireReviewer } from "@/lib/server/auth/guard";
import { toClientError } from "@/lib/server/http/errors";

/**
 * POST /api/rpc/comment - leave feedback without deciding the plan.
 *
 * This is deliberately separate from `/api/rpc/review`: a comment must not
 * move the plan into `returned`, change its grade or enter the compliance
 * figures. The SQL function owns authorization and writes the notification
 * and audit row.
 */
const bodySchema = z.object({
  documentId: z.string().uuid(),
  comment: z.string().trim().min(1, "Maklum balas diperlukan").max(2_000),
});

export async function POST(request: NextRequest) {
  const gate = await requireReviewer(request);
  if ("error" in gate) return gate.error;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }

  const { data, error } = await gate.db.rpc("comment_rph", {
    p_document: parsed.data.documentId,
    p_comment: parsed.data.comment,
  });
  if (error) return toClientError("[comment] rpc failed:", error);
  return NextResponse.json(data);
}
