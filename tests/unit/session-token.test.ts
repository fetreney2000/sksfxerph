import { describe, expect, it } from "vitest";
import { mintSession, parseSession, SESSION_TTL_SECONDS } from "@/lib/server/auth/token";

/**
 * Session cookie (Supabase Auth removed — sessions are ours).
 *
 * The invariant that matters: a cookie is only ever accepted if its HMAC
 * verifies *and* it hasn't expired. Everything else (active flag, password
 * change) is checked against the live row in `resolveUser`, so this module
 * only has to be airtight about forgery and expiry.
 */
const USER = "00000000-0000-4000-8000-000000000001";

describe("session token", () => {
  it("round-trips a freshly minted session", () => {
    const parsed = parseSession(mintSession(USER));
    expect(parsed).not.toBeNull();
    expect(parsed?.sub).toBe(USER);
    expect(parsed!.exp - parsed!.iat).toBe(SESSION_TTL_SECONDS);
  });

  it("is distinct per user", () => {
    const a = mintSession("00000000-0000-4000-8000-000000000001");
    const b = mintSession("00000000-0000-4000-8000-000000000002");
    expect(a).not.toBe(b);
    expect(parseSession(a)?.sub).not.toBe(parseSession(b)?.sub);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const cookie = mintSession(USER);
    const parts = cookie.split(".");
    // Swap in a different subject without knowing the secret.
    const forged = [
      Buffer.from("00000000-0000-4000-8000-00000000ffff").toString("base64url"),
      parts[1],
      parts[2],
      parts[3],
    ].join(".");
    expect(parseSession(forged)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const cookie = mintSession(USER);
    const parts = cookie.split(".");
    const flipped = parts[3]!.slice(0, -1) + (parts[3]!.endsWith("A") ? "B" : "A");
    expect(parseSession([parts[0], parts[1], parts[2], flipped].join("."))).toBeNull();
  });

  it("rejects an expired session", () => {
    const past = Date.now() - (SESSION_TTL_SECONDS + 60) * 1000;
    expect(parseSession(mintSession(USER, past))).toBeNull();
  });

  it("accepts a session minted just inside the window", () => {
    const recent = Date.now() - (SESSION_TTL_SECONDS - 60) * 1000;
    expect(parseSession(mintSession(USER, recent))).not.toBeNull();
  });

  it("rejects malformed input instead of throwing", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "not-a-cookie",
      "a.b.c",
      "a.b.c.d.e",
      "....",
      `${"x".repeat(64)}.notanumber.alsobad.sig`,
    ]) {
      expect(parseSession(bad as never)).toBeNull();
    }
  });

  it("treats a wrong-length signature as invalid", () => {
    const cookie = mintSession(USER);
    const parts = cookie.split(".");
    expect(parseSession([parts[0], parts[1], parts[2], "short"].join("."))).toBeNull();
  });
});
