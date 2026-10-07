import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/server/auth/password";

/**
 * Password storage (Supabase Auth removed — credentials live in `erph.user`).
 *
 * The properties that matter for a credential scheme: verification is exact,
 * tampering is detected, parameters are read from the stored string so they can
 * be upgraded, and a malformed hash fails *closed* rather than throwing in the
 * caller's face.
 */
describe("password hashing", () => {
  it("verifies the correct password", async () => {
    const hash = await hashPassword("cikgu123");
    expect(await verifyPassword("cikgu123", hash)).toBe(true);
  });

  it("rejects a wrong password, including near-misses", async () => {
    const hash = await hashPassword("cikgu123");
    expect(await verifyPassword("cikgu124", hash)).toBe(false);
    expect(await verifyPassword("cikgu12", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts per-password — same input, different hashes", async () => {
    const a = await hashPassword("sama");
    const b = await hashPassword("sama");
    expect(a).not.toBe(b);
    expect(await verifyPassword("sama", a)).toBe(true);
    expect(await verifyPassword("sama", b)).toBe(true);
  });

  it("uses the documented scrypt parameters in the PHC string", async () => {
    const hash = await hashPassword("satu");
    const parts = hash.split("$");
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toBe("16384");
    expect(parts[2]).toBe("8");
    expect(parts[3]).toBe("1");
    expect(parts).toHaveLength(6);
  });

  it("reads N/r/p from the stored string (upgradeable parameters)", async () => {
    // Re-issue the same password with weaker parameters; verification must
    // still work because the parameters come from the hash, not a constant.
    const original = await hashPassword("kunci");
    const [, , , , salt, digest] = original.split("$") as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const weakened = `scrypt$1024$8$1$${salt}$${digest}`;
    // Weaker params produce a different digest for the same input, so this is
    // expected to *fail* verification — proving we're not ignoring them.
    expect(await verifyPassword("kunci", weakened)).toBe(false);
  });

  it("fails closed on malformed stored values instead of throwing", async () => {
    for (const bad of [
      "",
      "not-a-hash",
      "scrypt$1$2$3",
      "bcrypt$1$2$3$4$5",
      "scrypt$x$y$z$a$b",
    ]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });

  it("verifyAgainstDummy burns time and always returns false", async () => {
    expect(await verifyAgainstDummy("nobody")).toBe(false);
  });

  it("round-trips a realistic Malay password", async () => {
    const pw = "GuruSekolah!2026";
    expect(await verifyPassword(pw, await hashPassword(pw))).toBe(true);
    expect(await verifyPassword("gurusekolah!2026", await hashPassword(pw))).toBe(false);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
