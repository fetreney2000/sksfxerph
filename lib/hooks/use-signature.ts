import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { supabaseConfigured } from "@/lib/config";
import { payloadHash, verifySignature } from "@/lib/signature";

/**
 * The signature sealing a plan, checked in the browser.
 *
 * The API returns the *material*, not a verdict, so this verifies it against
 * the payload on screen rather than trusting a `verified: true` someone else
 * computed. Two independent checks, because they answer different questions:
 *
 *   · does the signature actually cover this envelope? — cryptographic
 *   · does the envelope's hash match the plan being displayed? — content
 *
 * A seal can pass the first and fail the second: a genuine signature over an
 * older version of a plan that has since been edited back. Showing that as
 * valid would be worse than showing no seal at all.
 */
export type SignatureState = "none" | "pending" | "valid" | "invalid";

export interface SignatureResult {
  signature: SignaturePayload | null;
  state: SignatureState;
}

export function useSignature(
  documentId: string | undefined,
  payload: unknown | undefined,
): SignatureResult {
  const query = useQuery<{ signature: SignaturePayload | null }>({
    queryKey: ["signature", documentId],
    queryFn: async () => {
      const res = await fetch(`/api/rph/${documentId}/signature`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { signature: null };
      return (await res.json()) as { signature: SignaturePayload | null };
    },
    enabled: Boolean(documentId) && supabaseConfigured,
    // Signatures are append-only and never rewritten, so nothing can invalidate
    // this once it has resolved — refetching would only re-run the crypto.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const stored = query.data?.signature ?? null;
  const [state, setState] = React.useState<SignatureState>("none");

  React.useEffect(() => {
    if (!stored) {
      setState("none");
      return;
    }
    // Without the payload there is nothing to compare the envelope against —
    // render it as "still checking" rather than claiming validity we cannot
    // establish.
    if (!payload) {
      setState("pending");
      return;
    }

    let cancelled = false;
    setState("pending");
    void (async () => {
      const envelope = stored.envelope as { hash?: unknown };
      const contentMatches = envelope.hash === (await payloadHash(payload));
      const cryptoOk = await verifySignature(
        stored.publicKey,
        stored.envelope,
        stored.signature,
      );
      if (!cancelled) setState(contentMatches && cryptoOk ? "valid" : "invalid");
    })();

    return () => {
      cancelled = true;
    };
  }, [stored, payload]);

  return { signature: stored, state };
}
