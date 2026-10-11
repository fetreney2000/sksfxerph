import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyPassword } from "@/lib/server/auth/password";
import { JAWATAN_BY_ROLE, type MemberRole } from "@/lib/types";

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

/** `('username', 'scrypt$…', 'Full Name', 'email', 'role', jawatan, active)` */
function seededUsers(): {
  username: string;
  hash: string;
  role: string;
  jawatan: string | null;
}[] {
  const out: { username: string; hash: string; role: string; jawatan: string | null }[] = [];
  const row =
    /\('([a-z][\w.]+)',\s*'([^']+)',\s*'[^']*',\s*(?:'[^']*'|null),\s*'(\w+)',\s*(?:'(\w+)'|null),\s*(true|false)\)/g;
  for (const m of SQL.matchAll(row)) {
    out.push({ username: m[1]!, hash: m[2]!, role: m[3]!, jawatan: m[4] ?? null });
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
    expect(users.length).toBe(5);
    expect(Object.keys(passwords).length).toBe(4);
  });

  it("covers every member_role exactly once", () => {
    const roles = users.map((u) => u.role).sort();
    expect(roles).toEqual(["gpk", "guru_besar", "guru_biasa", "pentadbir", "system"]);
  });

  // An office the account's role cannot hold would be printed on a cover sheet
  // by someone who never held it — the exact failure `erph.jawatan_for`
  // refuses in SQL, checked here against the list the picker offers.
  it("only gives a seeded account an office its role may hold", () => {
    for (const u of users) {
      if (u.jawatan === null) continue;
      const offices = JAWATAN_BY_ROLE[u.role as MemberRole] ?? [];
      expect(
        offices,
        `${u.username} holds ${u.jawatan}, not one of ${offices.join(", ")}`,
      ).toContain(u.jawatan);
    }
  });

  it("states an office for the accounts that hold one", () => {
    const byRole = Object.fromEntries(users.map((u) => [u.role, u.jawatan]));
    expect(byRole.guru_biasa).toBe("guru_biasa");
    expect(byRole.guru_besar).toBe("guru_besar");
    // One GPK, so the seed may name the office — a school with several would
    // have to be told which, and that is the point of the column.
    expect(byRole.gpk).toBe("pk_pentadbiran");
    // Neither the administrator's account nor the service account holds an
    // office, and the cover sheet prints "—" rather than inventing one.
    expect(byRole.pentadbir).toBeNull();
    expect(byRole.system).toBeNull();
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

  // Every password checked against every *other* account is ~20 scrypt
  // verifications, and scrypt is slow on purpose — that is what makes it
  // worth using. The default 5s sits within a whisker of the honest cost on a
  // quiet machine and over it on a busy one, so this test was failing for
  // speed rather than for meaning.
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
  }, 60_000);

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
