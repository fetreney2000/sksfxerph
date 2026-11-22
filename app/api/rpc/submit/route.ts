import { type NextRequest, NextResponse } from "next/server";
import { requireDbUser } from "@/lib/server/auth/guard";
import { isUuid, toClientError } from "@/lib/server/http/errors";

/**
 * POST /api/rpc/submit - server-gated submission (`erph.submit_rph`).
 *
 * Moved out of the browser: with no Supabase JWT on the client, the RPC has to
 * be invoked by a handler that has already authenticated the session cookie.
 * The handler passes its user id as `X-Erph-User`, which `erph.actor()` inside
 * the RPC only honours because the secret key proved `service_role`.
 *
 * Returns the authoritative verdict - the server may disagree with the editor's
 * local completeness meter, and the server wins.
 */
export async function POST(request: NextRequest) {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  let body: { documentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  if (!isUuid(body.documentId)) {
    return NextResponse.json({ error: "ID dokumen diperlukan" }, { status: 400 });
  }

  // No `force`: a school that requires 100% completeness must not accept an
  // incomplete filing just because the caller knows the old parameter name.
  const { data, error } = await gate.db.rpc("submit_rph", {
    p_document: body.documentId,
    // Fixed false: no request may bypass the school's completeness rule.
    p_force: false,
  });

  if (error) {
    return toClientError("[submit] rpc failed:", error);
  }

  // `submit_rph` answers `{ok:false}` for an incomplete plan. Returning that
  // with 200 made a refusal look like a success to any caller that only checks
  // the status code.
  if (
    data &&
    typeof data === "object" &&
    "ok" in data &&
    (data as { ok?: unknown }).ok === false
  ) {
    return NextResponse.json(data, { status: 422 });
  }

  return NextResponse.json(data);
}
