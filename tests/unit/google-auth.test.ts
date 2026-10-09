import { describe, expect, it } from "vitest";
import { checkGoogleClaims, type GoogleClaims, resolveAccount } from "@/lib/server/auth/google";

/**
 * The rules that decide whether a Google identity may become a teacher here.
 *
 * Every case below is one that a plausible-looking implementation gets wrong:
 * a token that omits `hd` still carries a convincing email, an address that
 * was reassigned still resolves to a row, and a Workspace account from the
 * *wrong* domain is still a Workspace account.
 */

const NOW = new Date("2026-10-10T00:00:00Z");
const FUTURE = Math.floor(NOW.getTime() / 1000) + 3600;
const PAST = Math.floor(NOW.getTime() / 1000) - 3600;

const base: GoogleClaims = {
  sub: "118273645591827364559",
  email: "nurul.aisyah@moe-dl.edu.my",
  email_verified: true,
  hd: "moe-dl.edu.my",
  iss: "accounts.google.com",
  exp: FUTURE,
};

const opts = { domain: "moe-dl.edu.my", now: NOW };

describe("checkGoogleClaims", () => {
  it("accepts a verified account in the school's Workspace domain", () => {
    expect(checkGoogleClaims(base, opts)).toEqual({
      ok: true,
      sub: "118273645591827364559",
      email: "nurul.aisyah@moe-dl.edu.my",
    });
  });

  it("accepts the other issuer spelling Google uses", () => {
    expect(checkGoogleClaims({ ...base, iss: "https://accounts.google.com" }, opts).ok).toBe(
      true,
    );
  });

  it("treats the domain case-insensitively", () => {
    expect(checkGoogleClaims({ ...base, hd: "MOE-DL.EDU.MY" }, opts).ok).toBe(true);
  });

  // The single most important rule in the file. Google issues `hd` only to
  // Workspace accounts, so its absence is not "skip the check" — it is a
  // consumer Gmail account wearing a plausible address.
  it("rejects a token with no hd, which is a consumer account however it looks", () => {
    const { hd: _omitted, ...consumer } = base;
    expect(checkGoogleClaims(consumer, opts)).toEqual({
      ok: false,
      reason: "no-workspace-domain",
    });
  });

  it("rejects a Workspace account from the wrong domain", () => {
    expect(checkGoogleClaims({ ...base, hd: "example.com" }, opts)).toEqual({
      ok: false,
      reason: "wrong-domain",
    });
  });

  it("rejects an unverified email — a claim, not a fact", () => {
    expect(checkGoogleClaims({ ...base, email_verified: false }, opts)).toEqual({
      ok: false,
      reason: "unverified-email",
    });
  });

  it("rejects a missing email", () => {
    const { email: _omitted, ...noEmail } = base;
    expect(checkGoogleClaims(noEmail, opts)).toEqual({ ok: false, reason: "missing-email" });
  });

  it("rejects an unexpected issuer", () => {
    expect(checkGoogleClaims({ ...base, iss: "accounts.evil.example" }, opts)).toEqual({
      ok: false,
      reason: "wrong-issuer",
    });
  });

  it("rejects an expired token", () => {
    expect(checkGoogleClaims({ ...base, exp: PAST }, opts)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a missing sub", () => {
    const { sub: _omitted, ...noSub } = base;
    expect(checkGoogleClaims(noSub, opts)).toEqual({ ok: false, reason: "missing-sub" });
  });

  it("treats an empty sub as missing", () => {
    expect(checkGoogleClaims({ ...base, sub: "   " }, opts)).toEqual({
      ok: false,
      reason: "missing-sub",
    });
  });

  it("checks expiry at the boundary rather than a second late", () => {
    const atExp = new Date(FUTURE * 1000);
    expect(checkGoogleClaims(base, { ...opts, now: atExp }).ok).toBe(false);
  });
});

describe("resolveAccount", () => {
  const nurul = {
    id: "u-1",
    email: "nurul.aisyah@moe-dl.edu.my",
    google_sub: "118273645591827364559",
  };
  const ramlan = { id: "u-2", email: "ramlan.yusof@moe-dl.edu.my", google_sub: null };

  it("finds a linked account by sub and ignores the address entirely", () => {
    // Google says the address can be reassigned; the sub cannot. Signing in
    // here must not depend on it still matching.
    expect(
      resolveAccount({ sub: "118273645591827364559", email: "someone.else@moe-dl.edu.my" }, [
        nurul,
        ramlan,
      ]),
    ).toEqual({ kind: "registered", row: nurul });
  });

  it("links an unlinked account on first sign-in", () => {
    expect(
      resolveAccount({ sub: "999", email: "ramlan.yusof@moe-dl.edu.my" }, [nurul, ramlan]),
    ).toEqual({ kind: "link", row: ramlan });
  });

  it("matches email and sub case-insensitively", () => {
    expect(
      resolveAccount({ sub: "999", email: "Ramlan.Yusof@MOE-DL.EDU.MY" }, [nurul, ramlan]),
    ).toEqual({ kind: "link", row: ramlan });
  });

  it("refuses an address already bound to a *different* Google identity", () => {
    // The address has been reassigned. Resolving it as a sign-in would be
    // account takeover by inheritance — the new holder would inherit the old
    // holder's plans, supervision scope and review history.
    const reassigned = { id: "u-3", email: "nurul.aisyah@moe-dl.edu.my", google_sub: "000" };
    expect(
      resolveAccount({ sub: "999", email: "nurul.aisyah@moe-dl.edu.my" }, [reassigned]),
    ).toEqual({ kind: "not-registered" });
  });

  it("refuses an address that matches no account at all", () => {
    expect(
      resolveAccount({ sub: "999", email: "stranger@moe-dl.edu.my" }, [nurul, ramlan]),
    ).toEqual({ kind: "not-registered" });
  });

  // Auto-provisioning is deliberately absent. Every teacher in the ministry has
  // an @moe-dl.edu.my address, so "create one if none exists" would let any of
  // them walk into this school's records by typing its URL.
  it("never creates an account, however valid the identity", () => {
    expect(resolveAccount({ sub: "999", email: "new.teacher@moe-dl.edu.my" }, [])).toEqual({
      kind: "not-registered",
    });
  });

  it("is not fooled by an account whose email merely contains the address", () => {
    const lookalike = {
      id: "u-4",
      email: "nurul.aisyah@moe-dl.edu.my.evil.example",
      google_sub: null,
    };
    expect(
      resolveAccount({ sub: "999", email: "nurul.aisyah@moe-dl.edu.my" }, [lookalike]),
    ).toEqual({ kind: "not-registered" });
  });
});
