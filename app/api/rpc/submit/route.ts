import { type NextRequest, NextResponse } from "next/server";
import { requireDbUser } from "@/lib/server/auth/guard";

/**
 * POST /api/rpc/submit — server-gated submission (`erph.submit_rph`).
 *
 * Moved out of the browser: with no Supabase JWT on the client, the RPC has to
 * be invoked by a handler that has already authenticated the session cookie.
 * The handler passes its user id as `X-Erph-User`, which `erph.actor()` inside
 * the RPC only honours because the secret key proved `service_role`.
 *
 * Returns the authoritative verdict — the server may disagree with the editor's
 * local completeness meter, and the server wins.
 */
export async function POST(request: NextRequest) {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  let body: { documentId?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }

  const { data, error } = await gate.db.rpc("submit_rph", {
    p_document: body.documentId,
    p_force: body.force ?? false,
  });

  if (error) {
    console.error("[submit] rpc failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json(data);
}
