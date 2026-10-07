import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyPassword } from "@/lib/server/auth/password";

/**
 * Seed credentials (db/seed.sql).
 *
 * The seed ships the plaintext password in a comment next to each hash so you
 * can log in as every role. That comment is a *claim* — this test verifies it
 * against the actual scrypt hash, so a regenerated seed that quietly stops
 * matching its own documentation fails here rather than at someone's login
 * screen on a Monday morning.
 */

const SQL = readFileSync(path.join(process.cwd(), "db", "seed.sql"), "utf8");

/** `('username', 'scrypt$…', 'Full Name', 'email', 'role', active)` */
function seededUsers(): { username: string; hash: string; role: string }[] {
  const out: { username: string; hash: string; role: string }[] = [];
  const row =
    /\('([a-z][\w.]+)',\s*'([^']+)',\s*'[^']*',\s*(?:'[^']*'|null),\s*'(\w+)',\s*(true|false)\)/g;
  for (const m of SQL.matchAll(row)) {
    out.push({ username: m[1]!, hash: m[2]!, role: m[3]! });
  }
  return out;
}

/** `-- username: nurul.aisyah   password: guru2026` */
function documentedPasswords(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of SQL.matchAll(/--\s*username:\s*(\S+)\s+password:\s*(\S+)/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

describe("seeded accounts", () => {
  const users = seededUsers();
  const passwords = documentedPasswords();

  it("parses every seeded account", () => {
    expect(users.length).toBe(6);
    expect(Object.keys(passwords).length).toBe(5);
  });

  it("covers every member_role exactly once", () => {
    const roles = users.map((u) => u.role).sort();
    expect(roles).toEqual(["admin", "coordinator", "jpn", "ppd", "system", "teacher"]);
  });

  it("every documented password verifies against its stored hash", async () => {
    for (const [username, password] of Object.entries(passwords)) {
      const user = users.find((u) => u.username === username);
      expect(user, `no seeded row for ${username}`).toBeTruthy();
      expect(
        await verifyPassword(password, user!.hash),
        `password for ${username} does not match its hash`,
      ).toBe(true);
    }
  });

  it("each documented password is actually correct for its own account only", async () => {
    // Sanity: the hashes are per-account salted, so no two should verify the
    // same password even though they look similar.
    const entries = Object.entries(passwords);
    for (const [username, password] of entries) {
      for (const other of users) {
        if (other.username === username) continue;
        if (other.hash.startsWith("scrypt$")) {
          expect(
            await verifyPassword(password, other.hash),
            `${username}'s password should not open ${other.username}'s account`,
          ).toBe(false);
        }
      }
    }
  });

  it("the system account cannot log in", async () => {
    const sys = users.find((u) => u.role === "system");
    expect(sys).toBeTruthy();
    // Malformed hash → verifyPassword fails closed for every input.
    expect(await verifyPassword("anything", sys!.hash)).toBe(false);
    expect(await verifyPassword("", sys!.hash)).toBe(false);
  });

  it("uses the same scrypt parameters as the runtime verifier", () => {
    for (const u of users.filter((u) => u.hash.startsWith("scrypt$"))) {
      const [algo, n, r, p] = u.hash.split("$");
      expect([algo, n, r, p]).toEqual(["scrypt", "16384", "8", "1"]);
    }
  });
});
