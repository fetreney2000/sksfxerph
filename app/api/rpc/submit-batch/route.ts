import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/server/auth/guard";
import { toClientError } from "@/lib/server/http/errors";

/**
 * POST /api/rpc/submit-batch - submit a week atomically.
 *
 * The archive's completeness preflight is a courtesy; this is the write that
 * has to be all-or-nothing. `erph.submit_rph_batch` validates every document
 * before updating any, so a refusal rolls the whole set back.
 */
const bodySchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1, "Tiada RPH dipilih").max(50),
});

export async function POST(request: NextRequest) {
  const gate = await requireDbUser(request);
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
      { error: parsed.error.issues[0]?.message ?? "Senarai RPH tidak sah" },
      { status: 422 },
    );
  }

  const { data, error } = await gate.db.rpc("submit_rph_batch", {
    p_documents: parsed.data.documentIds,
  });
  if (error) return toClientError("[submit-batch] rpc failed:", error);
  return NextResponse.json(data);
}
