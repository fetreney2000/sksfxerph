import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The login route's account lockout.
 *
 * The lock is what stops a password being guessed, and it used to have a
 * second, unintended life: the failure counter outlived the lock it had set.
 * Once a lock expired the count was still five, so the very next wrong guess
 * re-armed it — and because the counter was only ever cleared by a successful
 * sign-in, the account's owner could not clear it either. One request every
 * fifteen minutes kept any account locked, for good, and the school's only
 * administrator could have been reached the same way.
 */

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  role: string;
  password_hash: string;
  is_active: boolean;
  failed_logins: number;
  locked_until: string | null;
}

/** The real scrypt hash of "biasa123" — so the verification path is the real one. */
const HASH =
  "scrypt$16384$8$1$l5LNcBYQOSm6M_tOuRNTyw$OIhgfFgcxiGTo2GeOra-dmMfOc8KlQeHl1szR9cN9UlvxU_lB86lLYutFhYlCM1Axphko8kuo3qvqJQxaG135g";

const store = vi.hoisted(() => ({
  users: new Map<
    string,
    {
      id: string;
      username: string;
      full_name: string;
      email: string | null;
      role: string;
      password_hash: string;
      is_active: boolean;
      failed_logins: number;
      locked_until: string | null;
    }
  >(),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  // Synced mode: the lockout lives in the branch that reads `erph.user`.
  return { ...actual, supabaseConfigured: true };
});

vi.mock("@/lib/server/db", () => ({
  adminDb: () => ({
    from(table: string) {
      if (table !== "user") throw new Error(`unexpected table ${table}`);
      const chain = {
        row: null as UserRow | null,
        select() {
          return chain;
        },
        ilike(_column: string, value: string) {
          chain.row = [...store.users.values()].find((u) => u.username === value) ?? null;
          return chain;
        },
        limit() {
          return chain;
        },
        async maybeSingle() {
          return { data: chain.row, error: null };
        },
        update(patch: Partial<UserRow>) {
          return {
            async eq(_column: string, id: string) {
              const row = store.users.get(id);
              if (row) Object.assign(row, patch);
              return { data: null, error: null };
            },
          };
        },
      };
      return chain;
    },
  }),
}));

const { POST } = await import("@/app/api/auth/login/route");

const USER_ID = "00000000-0000-4000-8000-000000000002";

function post(username: string, password: string) {
  return new NextRequest(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  );
}

function seed(overrides: Partial<UserRow> = {}) {
  const row: UserRow = {
    id: USER_ID,
    username: "guru.biasa",
    full_name: "Suhaila binti Hassan",
    email: null,
    role: "guru_biasa",
    password_hash: HASH,
    is_active: true,
    failed_logins: 0,
    locked_until: null,
    ...overrides,
  };
  store.users.set(row.id, row);
  return row;
}

describe("the login lockout", () => {
  beforeEach(() => {
    store.users.clear();
  });

  it("counts a wrong password", async () => {
    const row = seed();
    const res = await POST(post("guru.biasa", "salah"));
    expect(res.status).toBe(401);
    expect(row.failed_logins).toBe(1);
  });

  it("locks the account on the fifth failure", async () => {
    const row = seed({ failed_logins: 4 });
    await POST(post("guru.biasa", "salah"));
    expect(row.failed_logins).toBe(5);
    expect(row.locked_until).not.toBeNull();
  });

  it("does not extend a lock that is already standing", async () => {
    const until = new Date(Date.now() + 15 * 60_000).toISOString();
    const row = seed({ failed_logins: 5, locked_until: until });
    await POST(post("guru.biasa", "salah"));
    expect(row.failed_logins).toBe(5);
    expect(row.locked_until).toBe(until);
  });

  it("starts the count again once the lock has expired", async () => {
    // The regression: the counter used to outlive the lock, so the next guess
    // re-armed it and one request per window held the account for good.
    const row = seed({
      failed_logins: 5,
      locked_until: new Date(Date.now() - 60_000).toISOString(),
    });
    await POST(post("guru.biasa", "salah"));
    expect(row.failed_logins).toBe(1);
    expect(row.locked_until).toBeNull();
  });

  it("lets the owner back in once the lock has expired", async () => {
    const row = seed({
      failed_logins: 5,
      locked_until: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await POST(post("guru.biasa", "biasa123"));
    expect(res.status).toBe(200);
    expect(row.failed_logins).toBe(0);
    expect(row.locked_until).toBeNull();
  });

  it("says the account is locked when the password is right", async () => {
    seed({
      failed_logins: 5,
      locked_until: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    const res = await POST(post("guru.biasa", "biasa123"));
    expect(res.status).toBe(423);
  });

  it("answers the same way for an account that does not exist", async () => {
    const res = await POST(post("tidak.ada", "salah"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Nama pengguna atau kata laluan salah.",
    });
  });
});
