import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";

vi.hoisted(() => {
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ?? "unit-test-secret-0123456789abcdef0123456789abcdef";
});

const USER_ID = "00000000-0000-4000-8000-000000000002";
const SCHOOL_ID = "99999999-9999-4999-8999-999999999999";
const state = vi.hoisted(() => ({ calls: [] as { name: string; params: unknown }[] }));

vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  supabaseConfigured: true,
}));

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
              role: "guru_biasa",
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
      // biome-ignore lint/suspicious/noThenProperty: a supabase builder is thenable on purpose.
      chain.then = (onOk: unknown, onErr: unknown) =>
        Promise.resolve({ data: [], error: null }).then(
          onOk as (value: unknown) => unknown,
          onErr as (error: unknown) => unknown,
        );
      return chain;
    },
    rpc: (name: string, params: unknown) => {
      state.calls.push({ name, params });
      return Promise.resolve({
        data: { ok: true, count: 2, items: [] },
        error: null,
      });
    },
  }),
}));

const { POST } = await import("@/app/api/rpc/submit-batch/route");

function post(body: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/rpc/submit-batch", {
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
  state.calls.length = 0;
});

describe("POST /api/rpc/submit-batch", () => {
  it("refuses an empty or malformed list before the RPC runs", async () => {
    expect((await POST(post({ documentIds: [] }))).status).toBe(422);
    expect((await POST(post({ documentIds: ["bukan-uuid"] }))).status).toBe(422);
    expect(state.calls).toEqual([]);
  });

  it("passes the whole set to one transactional RPC", async () => {
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    const res = await POST(post({ documentIds: ids }));

    expect(res.status).toBe(200);
    expect(state.calls).toEqual([{ name: "submit_rph_batch", params: { p_documents: ids } }]);
  });
});
