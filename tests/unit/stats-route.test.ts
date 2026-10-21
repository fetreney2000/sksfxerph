import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";

/**
 * GET /api/stats, and who may ask for it.
 *
 * The dashboard hid the school's totals from a Guru Biasa while this endpoint
 * served them to anyone signed in — a card removed without the request behind
 * it being removed is a hidden door, not a closed one. Whole-school figures are
 * a supervisor's question, and this is the boundary that now says so.
 */

const TEACHER_ID = "00000000-0000-4000-8000-000000000002";
const GPK_ID = "00000000-0000-4000-8000-000000000003";
const SCHOOL_ID = "99999999-9999-4999-8999-999999999999";

const state = vi.hoisted(() => ({
  /** Who is signing in. The route's whole answer turns on this. */
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
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === "user") {
            return {
              data: {
                id: state.role === "gpk" ? GPK_ID : TEACHER_ID,
                username: "seseorang",
                full_name: "Seseorang",
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
        },
      };
      return chain;
    },
    rpc: (name: string) => {
      state.rpcCalls.push(name);
      // `school_week_stats` answers with one row; the history with the weeks.
      const data =
        name === "school_week_stats"
          ? [
              {
                teachers: 1,
                expected: 5,
                submitted: 1,
                approved: 1,
                returned_t: 0,
                drafts: 4,
                compliance: 20,
              },
            ]
          : [];
      return Promise.resolve({ data, error: null });
    },
  }),
}));

const { GET } = await import("@/app/api/stats/route");

function get(): NextRequest {
  const who = state.role === "gpk" ? GPK_ID : TEACHER_ID;
  return new NextRequest(
    new Request("http://localhost/api/stats", {
      headers: { cookie: `${SESSION_COOKIE}=${mintSession(who)}` },
    }),
  );
}

beforeEach(() => {
  state.rpcCalls.length = 0;
});

describe("GET /api/stats", () => {
  it("refuses a Guru Biasa, and never asks the database on their behalf", async () => {
    state.role = "guru_biasa";

    const res = await GET(get());

    expect(res.status).toBe(403);
    // Not merely unanswered by the UI: the request that would have carried the
    // school's figures was never made.
    expect(state.rpcCalls).toEqual([]);
  });

  it("answers a supervisor", async () => {
    state.role = "gpk";

    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(state.rpcCalls).toContain("school_week_stats");
    expect(state.rpcCalls).toContain("school_week_history");
  });
});
