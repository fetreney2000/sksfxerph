/**
 * Signing an eRPH approval.
 *
 * ## What is signed
 *
 * Not the payload itself, but a compact envelope that *describes* what was
 * signed: the document, the version it had, a hash of its payload, the signer,
 * the decision and the time. Signing the whole payload would put kilobytes
 * under the signature for no extra assurance — the hash binds it just as
 * tightly — and it keeps the envelope small enough to be read and argued about
 * in a dispute.
 *
 * ## Where the keys live
 *
 * The signer's key pair is generated in their browser and the private half
 * never leaves it. Only the public key reaches the database. That is the whole
 * reason for asymmetric signing here: a server-held key could produce any
 * reviewer's mark, which is a tamper-evident record but not a signature, and
 * Malaysian law (Electronic Commerce Act 2006) asks that a signature be under
 * the *signatory's* control.
 *
 * ## Why the database cannot verify any of this
 *
 * PostgreSQL cannot: pgcrypto's own documentation says "No support for
 * signing". So verification happens where the crypto exists — the browser and
 * Node — and the database contributes only a guarantee about *who may append*:
 * `erph.rph_signature` has no INSERT policy, so only our server writes to it,
 * and only after it has verified the signature. See erph.rph_signature.
 */

import { canonicalize, fromBase64Url, sha256Hex, toBase64Url, utf8 } from "./canonical";

export { canonicalize, sha256Hex } from "./canonical";

/** ECDSA P-256 with SHA-256. Universally supported by WebCrypto *and* Node. */
export const ALGORITHM = "ES256" as const;

export interface SignatureEnvelope {
  /** Envelope version, so a future format change stays verifiable. */
  v: 1;
  alg: typeof ALGORITHM;
  /** base64url SPKI public key — repeated so a retired key still verifies. */
  kid: string;
  doc: string;
  /** The `rph_document.version` this signature covers. */
  ver: number;
  /** sha256 of the canonical payload. */
  hash: string;
  signer: string;
  decision: "sahkan";
  at: string;
}

/**
 * Refuse anything this file cannot canonicalise correctly.
 *
 * The canonicaliser in `./canonical` is RFC 8785 for the I-JSON subset our
 * envelopes use, and its number rule is the one part that is subset-dependent.
 * Rather than let a later field silently break every signature ever made,
 * signing fails loudly on a fractional or non-finite number — which is the
 * only shape that would do it.
 */
function assertSignable(value: unknown, path = "$"): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(
        `${path}: fractional numbers are outside the canonicalisation this file guarantees`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => {
      assertSignable(entry, `${path}[${i}]`);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      assertSignable(entry, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path}: ${typeof value} cannot be signed`);
}

/** sha256 of a payload's canonical bytes, lowercase hex. */
export async function payloadHash(payload: unknown): Promise<string> {
  assertSignable(payload);
  return sha256Hex(canonicalize(payload));
}

export async function buildEnvelope(input: {
  documentId: string;
  version: number;
  payload: unknown;
  signerId: string;
  publicKey: string;
  /** Overridable so a test can pin the clock. */
  at?: string;
}): Promise<SignatureEnvelope> {
  return {
    v: 1,
    alg: ALGORITHM,
    kid: input.publicKey,
    doc: input.documentId,
    ver: input.version,
    hash: await payloadHash(input.payload),
    signer: input.signerId,
    decision: "sahkan",
    at: input.at ?? new Date().toISOString(),
  };
}

/** A signer's key pair, in the only two forms we ever need. */
export interface SigningKeyPair {
  /** base64url SPKI — registered with the server, and published on every row. */
  publicKey: string;
  /** base64url PKCS8 — stays on this device. Never sent anywhere. */
  privateKey: string;
}

const CURVE = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;

export async function generateSigningKey(): Promise<SigningKeyPair> {
  const pair = await crypto.subtle.generateKey(CURVE, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return { publicKey: toBase64Url(spki), privateKey: toBase64Url(pkcs8) };
}

async function importPrivate(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", fromBase64Url(b64), CURVE, false, ["sign"]);
}

async function importPublic(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", fromBase64Url(b64), CURVE, false, ["verify"]);
}

/** Detached signature over the envelope's canonical bytes. */
export async function signEnvelope(
  envelope: SignatureEnvelope,
  privateKey: string,
): Promise<string> {
  const key = await importPrivate(privateKey);
  const bytes = utf8(canonicalize(envelope));
  const signature = await crypto.subtle.sign(SIGN_PARAMS, key, bytes);
  // WebCrypto ECDSA returns raw r‖s (IEEE P1363), not DER — so it is a fixed
  // 64 bytes and there is no conversion, and no DER-parser bug, to get wrong.
  return toBase64Url(new Uint8Array(signature));
}

/**
 * Verify a stored signature against the envelope the database holds.
 *
 * Returns `false` rather than throwing: an unverifiable signature is a
 * *result* — the claim is still there, it just does not hold up — and a caller
 * rendering a document must not have an exception interrupt the render.
 *
 * This runs in the browser too, so a reviewer can check one themselves instead
 * of taking the server's word for it.
 */
export async function verifySignature(
  publicKey: string,
  envelope: unknown,
  signature: string,
): Promise<boolean> {
  try {
    const key = await importPublic(publicKey);
    const bytes = utf8(canonicalize(envelope));
    return await crypto.subtle.verify(SIGN_PARAMS, key, fromBase64Url(signature), bytes);
  } catch {
    return false;
  }
}
