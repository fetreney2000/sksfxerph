import { describe, expect, it } from "vitest";
import { hashPayload } from "@/lib/sync/hash";

/**
 * The hash decides whether a sync op actually changed anything, so it must be
 * stable across key order but sensitive to nested content.
 */
describe("hashPayload", () => {
  it("is stable regardless of key order", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it("includes nested keys (regression: JSON.stringify replacer dropped them)", () => {
    const one = { aktiviti: [{ nama: "Set induksi", sub: false }] };
    const two = { aktiviti: [{ nama: "Set induksi", sub: true }] };
    expect(hashPayload(one)).not.toBe(hashPayload(two));
  });

  it("detects changes nested two levels deep", () => {
    expect(hashPayload({ a: { b: { c: 1 } } })).not.toBe(hashPayload({ a: { b: { c: 2 } } }));
  });

  it("treats arrays as ordered", () => {
    expect(hashPayload({ a: [1, 2] })).not.toBe(hashPayload({ a: [2, 1] }));
  });

  it("ignores undefined values", () => {
    expect(hashPayload({ a: 1, b: undefined })).toBe(hashPayload({ a: 1 }));
  });

  it("returns a stable-length hex string", () => {
    expect(hashPayload({ x: "y" })).toMatch(/^[0-9a-f]{8}$/);
  });
});
