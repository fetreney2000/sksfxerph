import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";

/**
 * Input shape gates on the write paths.
 *
 * SQL used to be the first thing to see this identifier: a malformed
 * `documentId` died inside a `::uuid` cast and the 22P02 text went straight to
 * the client. The route now refuses it with a 400 before any query runs -
 * proved here by asserting the RPC is never reached.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ?? "unit-test-secret-0123456789abcdef0123456789abcdef";
});

const USER_ID = "00000000-0000-4000-8000-000000000002";
const SCHOOL_ID = "99999999-9999-4999-8999-999999999999";

const state = vi.hoisted(() => ({
  role: "guru_biasa" as string,
  rpcCalls: [] as string[],
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

vi.mock("@/lib/server/db", () => ({
  hasAdminCredentials: () => true,
  adminDb: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "in", "order", "limit", "is"]) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => {
        if (table === "user") {
          return {
            data: {
              id: USER_ID,
              username: "guru.biasa",
              full_name: "Suhaila binti Hassan",
              email: null,
              role: state.role,
              is_active: true,
              password_changed_at: new Date(0).toISOString(),
            },
            error: null,
          };
        }
        if (table === "school_member") return { data: { school_id: SCHOOL_ID }, error: null };
        if (table === "school_setting") {
          return { data: { current_session: "2026/2027" }, error: null };
        }
        return { data: null, error: null };
      };
      // biome-ignore lint/suspicious/noThenProperty: a supabase builder is thenable on purpose - every caller reads it with `await … .eq()`, and a mock that is not would await into nothing.
      chain.then = (onOk: unknown, onErr: unknown) =>
        Promise.resolve({ data: [], error: null }).then(
          onOk as (v: unknown) => unknown,
          onErr as (e: unknown) => unknown,
        );
      return chain;
    },
    rpc: (name: string) => {
      state.rpcCalls.push(name);
      if (name === "submit_rph") {
        return Promise.resolve({
          data: { ok: true, status: "submitted", completeness: 100, version: 2 },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const { POST: SUBMIT } = await import("@/app/api/rpc/submit/route");

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${mintSession(USER_ID)}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.role = "guru_biasa";
  state.rpcCalls.length = 0;
});

describe("POST /api/rpc/submit - identifier shape", () => {
  it("refuses a non-UUID document id before the RPC runs", async () => {
    const res = await SUBMIT(post("/api/rpc/submit", { documentId: "bukan-uuid" }));

    expect(res.status).toBe(400);
    expect(state.rpcCalls).toEqual([]);
  });

  it("refuses a missing document id the same way it always did", async () => {
    const res = await SUBMIT(post("/api/rpc/submit", {}));

    expect(res.status).toBe(400);
    expect(state.rpcCalls).toEqual([]);
  });

  it("passes a well-formed id through to the RPC", async () => {
    const res = await SUBMIT(
      post("/api/rpc/submit", { documentId: "22222222-2222-4222-8222-222222222222" }),
    );

    expect(res.status).toBe(200);
    expect(state.rpcCalls).toEqual(["submit_rph"]);
  });
});
