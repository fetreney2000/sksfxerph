import { describe, expect, it } from "vitest";
import {
  buildEnvelope,
  canonicalize,
  generateSigningKey,
  payloadHash,
  signEnvelope,
  verifySignature,
} from "@/lib/signature";

/**
 * The signature is the part of this feature where being wrong is expensive and
 * quiet: a signature that verifies over the wrong bytes still *looks* valid on
 * a printed RPH. So the things that would make it wrong are asserted directly —
 * canonicalisation, payload binding, and both tampering directions.
 */
const DOC = "11111111-1111-4111-8111-111111111111";
const SIGNER = "22222222-2222-4222-8222-222222222222";

describe("canonicalisation", () => {
  it("produces the same bytes whatever the key order was", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts recursively, not just at the top", () => {
    expect(canonicalize({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it("keeps array order — arrays are ordered, objects are not", () => {
    expect(canonicalize({ xs: [3, 1, 2] })).toBe('{"xs":[3,1,2]}');
  });

  it("drops nothing and adds no whitespace", () => {
    expect(canonicalize({ s: "a b", n: null, t: true, e: "" })).toBe(
      '{"e":"","n":null,"s":"a b","t":true}',
    );
  });
});

describe("payload binding", () => {
  it("hashes the same content the same way", async () => {
    expect(await payloadHash({ obj: "Matematik", n: 5 })).toBe(
      await payloadHash({ n: 5, obj: "Matematik" }),
    );
  });

  it("changes the hash when the content does", async () => {
    expect(await payloadHash({ obj: "Matematik" })).not.toBe(
      await payloadHash({ obj: "Sains" }),
    );
  });

  it("refuses a fractional number rather than leaving the JCS subset quietly", async () => {
    // `JSON.stringify`'s number formatting is only guaranteed by the canonical
    // implementation for integers, so an envelope carrying 1.5 would be signed
    // over bytes another implementation might not reproduce.
    await expect(payloadHash({ a: 1.5 })).rejects.toThrow(/fractional/);
  });
});

describe("signing an approval", () => {
  it("verifies its own signature", async () => {
    const key = await generateSigningKey();
    const envelope = await buildEnvelope({
      documentId: DOC,
      version: 12,
      payload: { obj: "Matematik" },
      signerId: SIGNER,
      publicKey: key.publicKey,
    });
    const signature = await signEnvelope(envelope, key.privateKey);

    expect(await verifySignature(key.publicKey, envelope, signature)).toBe(true);
  });

  it("refuses the same signature against an edited envelope", async () => {
    const key = await generateSigningKey();
    const envelope = await buildEnvelope({
      documentId: DOC,
      version: 12,
      payload: { obj: "Matematik" },
      signerId: SIGNER,
      publicKey: key.publicKey,
    });
    const signature = await signEnvelope(envelope, key.privateKey);

    // The classic mistake: re-hashing new content and pairing it with the old
    // signature. Verification must fail on the envelope, not just the payload.
    const edited = { ...envelope, ver: 13 };
    expect(await verifySignature(key.publicKey, edited, signature)).toBe(false);
  });

  it("refuses a mutated signature", async () => {
    const key = await generateSigningKey();
    const envelope = await buildEnvelope({
      documentId: DOC,
      version: 1,
      payload: {},
      signerId: SIGNER,
      publicKey: key.publicKey,
    });
    const good = await signEnvelope(envelope, key.privateKey);
    // Flip a character within the middle, keeping it valid base64url so the
    // failure is cryptographic rather than a parse error.
    const middle = good.length / 2;
    const flipped = good[middle] === "A" ? "B" : "A";
    const bad = `${good.slice(0, middle)}${flipped}${good.slice(middle + 1)}`;

    expect(await verifySignature(key.publicKey, envelope, bad)).toBe(false);
  });

  it("refuses another signer's key", async () => {
    const mine = await generateSigningKey();
    const theirs = await generateSigningKey();
    const envelope = await buildEnvelope({
      documentId: DOC,
      version: 1,
      payload: {},
      signerId: SIGNER,
      publicKey: mine.publicKey,
    });
    const signature = await signEnvelope(envelope, mine.privateKey);

    expect(await verifySignature(theirs.publicKey, envelope, signature)).toBe(false);
  });

  it("reports false rather than throwing when the key is nonsense", async () => {
    const key = await generateSigningKey();
    const envelope = await buildEnvelope({
      documentId: DOC,
      version: 1,
      payload: {},
      signerId: SIGNER,
      publicKey: key.publicKey,
    });
    // A document rendering a signature must not be interrupted by one that
    // will not verify — an unverifiable signature is a *result*.
    expect(await verifySignature("not-a-key", envelope, "not-a-signature")).toBe(false);
  });

  it("is non-deterministic — ECDSA draws a fresh nonce each time", async () => {
    const key = await generateSigningKey();
    const envelope = await buildEnvelope({
      documentId: DOC,
      version: 7,
      payload: { obj: "Sains" },
      signerId: SIGNER,
      publicKey: key.publicKey,
      at: "2026-10-10T00:00:00.000Z",
    });

    const first = await signEnvelope(envelope, key.privateKey);
    const second = await signEnvelope(envelope, key.privateKey);

    // Not Ed25519: signing the same bytes twice does *not* reproduce the same
    // signature, so anything comparing signatures for equality is wrong. What
    // has to hold is that both verify — and it does, which is why the stored
    // row is identified by (document, version, signer) rather than by value.
    expect(first).not.toBe(second);
    expect(await verifySignature(key.publicKey, envelope, first)).toBe(true);
    expect(await verifySignature(key.publicKey, envelope, second)).toBe(true);
  });

  it("binds the document, the version and the payload together", async () => {
    const key = await generateSigningKey();
    const envelope = await buildEnvelope({
      documentId: DOC,
      version: 4,
      payload: { obj: "BM" },
      signerId: SIGNER,
      publicKey: key.publicKey,
    });

    expect(envelope.doc).toBe(DOC);
    expect(envelope.ver).toBe(4);
    expect(envelope.signer).toBe(SIGNER);
    expect(envelope.decision).toBe("sahkan");
    expect(envelope.alg).toBe("ES256");
    expect(envelope.hash).toBe(await payloadHash({ obj: "BM" }));
  });
});
