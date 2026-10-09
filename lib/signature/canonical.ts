/**
 * Canonical JSON and the SHA-256 over it.
 *
 * A signature over `JSON.stringify(payload)` would be worthless the moment two
 * implementations disagreed about key order or number formatting — which they
 * do, routinely. RFC 8785 (JCS) fixes the byte sequence a JSON value maps to,
 * so the browser that signed and the Node process verifying produce identical
 * bytes from the same data model.
 *
 * ── Why this is not a full JCS implementation ────────────────────────────────
 * JCS constrains three things: key order, whitespace, and *number* formatting.
 * The number rule is the awkward one (ECMAScript's Number::toString, which is
 * not the same as what every language does by default).
 *
 * Our envelopes carry strings, one integer, booleans and null — I-JSON, and no
 * fractional or non-finite numbers at all. For that subset, sorting keys
 * recursively and handing the result to `JSON.stringify` is exactly JCS:
 * `JSON.stringify` already implements the required number formatting, and it
 * emits no whitespace. If a fractional number is ever added to an envelope,
 * this stops being true and needs a real canonicaliser — the check in
 * `envelope` asserts the invariant rather than assuming it.
 */

/** Recursively sort object keys, leaving arrays in order (JCS §3.2.3). */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key]);
    return out;
  }
  return value;
}

/** The hashable byte sequence for a JSON value, as a UTF-8 string. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** base64url without padding — the encoding JWS/WebAuthn use, and what we store. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Returns `Uint8Array<ArrayBuffer>` on purpose rather than the plain alias.
 *
 * TS 5.9 tightened `BufferSource` to exclude views over a `SharedArrayBuffer`,
 * and `atob`'s result would otherwise infer `ArrayBufferLike` — which makes
 * `crypto.subtle.verify(...)` refuse the argument. Copying into a fresh
 * `ArrayBuffer` keeps the value identical and the type accepted.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** UTF-8 bytes, over an `ArrayBuffer` for the same reason as above. */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  const src = new TextEncoder().encode(text);
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}
