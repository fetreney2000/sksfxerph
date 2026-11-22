import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/server/auth/guard";
import { toClientError } from "@/lib/server/http/errors";

/**
 * POST /api/rpc/unapprove - reopen an approved plan.
 *
 * The RPC owns the authorization (Guru Besar or pentadbir, same school), the
 * mandatory reason, the append-only review row and the teacher notification.
 * This handler only validates the transport shape; there is no client-chosen
 * status here.
 */
const bodySchema = z.object({
  documentId: z.string().uuid(),
  reason: z.string().trim().min(1, "Sebab pembatalan diperlukan").max(2_000),
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
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }

  const { data, error } = await gate.db.rpc("batal_sahkan_rph", {
    p_document: parsed.data.documentId,
    p_reason: parsed.data.reason,
  });
  if (error) return toClientError("[unapprove] rpc failed:", error);
  return NextResponse.json(data);
}
