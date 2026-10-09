/**
 * Thin fetch wrappers for the RPC-backed route handlers.
 *
 * These replace `lib/supabase/rpc.ts`, which used to call PostgREST from the
 * browser with the user's Supabase JWT. Authentication is now the httpOnly
 * session cookie (sent automatically, same-origin); authorization is re-applied
 * server-side by `requireUser`/`requireReviewer` and again inside the SQL RPCs
 * via `erph.actor()`.
 *
 * `null` means "local mode / not available" — callers apply their own local
 * rule, so a deployment without Supabase still works rather than losing a
 * feature. Anything else throws `RpcError`, which carries the HTTP status so a
 * caller can tell "your session died" (401/403) apart from "the server is
 * having a bad day" (5xx).
 */

export class RpcError extends Error {
  constructor(
    readonly fn: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${fn}: ${message}`);
    this.name = "RpcError";
  }

  /** Session is gone — the caller must not claim success. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network failure: let the caller decide (offline-first means falling
    // through to the local rule, not surfacing a hard error).
    throw new RpcError(path, err instanceof Error ? err.message : "ralat rangkaian");
  }

  // A 500 page, a proxy error or an empty body must not blow up as an
  // unhandled SyntaxError — parse defensively and keep the status.
  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }

  if (res.status === 503) return null; // local mode

  if (!res.ok) {
    const msg =
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new RpcError(path, msg, res.status);
  }

  if (json === null) {
    throw new RpcError(path, "tindak balas tidak sah", res.status);
  }
  return json as T;
}

export interface SubmitResult {
  ok: boolean;
  completeness?: number;
  error?: string;
  status?: string;
}

/** Server-gated submission; the server's verdict wins over the local meter. */
export const submitRph = (documentId: string, force = false) =>
  post<SubmitResult>("/api/rpc/submit", { documentId, force });

export type ReviewDecision = "sahkan" | "hantar_balik";

/**
 * Decide a plan.
 *
 * An approval must carry the envelope and signature produced over the
 * document's current version — the server recomputes the payload hash and
 * verifies the signature before it will append anything. `decide()` in
 * `lib/signature/review.ts` builds both; calling this directly with a missing
 * or stale signature is refused, which is the point.
 */
export const reviewRph = (body: {
  documentId: string;
  decision: ReviewDecision;
  comment?: string;
  envelope?: unknown;
  signature?: string;
}) => post<{ ok: boolean; grade: number; status: string }>("/api/rpc/review", body);
