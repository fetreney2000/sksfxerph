import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";

/**
 * /api/admin/calendar — who may declare which week a date range is.
 *
 * This write constrains every teacher's dashboard, not just the caller's: the
 * breadcrumb, the week picker and the deadline all read the number it sets. So
 * the first thing worth proving is the gate, and the second is that the session
 * is read from the school's own setting rather than from the request — `session`
 * is half the table's primary key, and a caller who chose it could file
 * declarations into a year the school is not running.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SCHOOL_ID = "99999999-9999-4999-8999-999999999999";

const state = vi.hoisted(() => ({
  /** Who is signing in. The route's whole answer turns on this. */
  role: "guru_biasa" as string,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

vi.mock("@/lib/server/db", () => ({
  hasAdminCredentials: () => true,
  adminDb: () => ({
    from(table: string) {
      // A supabase builder: every filter returns itself and the awaited result
      // is the final `{ data, error }`. Made thenable so `await … .eq().eq()`
      // and `await … .maybeSingle()` both work without knowing which path a
      // handler happens to take.
      const answer =
        table === "user"
          ? {
              id: USER_ID,
              username: "pentadbir",
              role: state.role,
              is_active: true,
              full_name: "Pentadbir",
              email: null,
              password_changed_at: new Date(0).toISOString(),
            }
          : table === "school_member"
            ? { school_id: SCHOOL_ID }
            : table === "school_setting"
              ? { current_session: "2026/2027" }
              : [];

      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "in", "order", "limit", "is"]) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => ({ data: answer, error: null });
      chain.single = async () => ({ data: answer, error: null });
      // biome-ignore lint/suspicious/noThenProperty: a supabase builder is thenable on purpose — every caller reads it with `await … .eq()`, and a mock that is not would await into nothing.
      chain.then = (onOk: unknown, onErr: unknown) =>
        Promise.resolve({ data: answer, error: null }).then(
          onOk as (v: unknown) => unknown,
          onErr as (e: unknown) => unknown,
        );
      return chain;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const { GET, PATCH, DELETE } = await import("@/app/api/admin/calendar/route");

const cookie = { cookie: `${SESSION_COOKIE}=${mintSession(USER_ID)}` };

function patch(body: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/admin/calendar", {
      method: "PATCH",
      headers: { ...cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function deleteRequest(weekNo: string): NextRequest {
  return new NextRequest(
    new Request(`http://localhost/api/admin/calendar?weekNo=${weekNo}`, {
      method: "DELETE",
      headers: cookie,
    }),
  );
}

beforeEach(() => {
  state.role = "guru_biasa";
  state.rpcCalls.length = 0;
});

describe("who may declare a week", () => {
  it("refuses a Guru Biasa, and never reaches the database on their behalf", async () => {
    const res = await PATCH(
      patch({ weekNo: 34, startDate: "2026-10-19", endDate: "2026-10-23" }),
    );

    expect(res.status).toBe(403);
    expect(state.rpcCalls).toEqual([]);
  });

  it("refuses a Guru Biasa from reading the admin view too", async () => {
    const res = await GET(
      new NextRequest(new Request("http://localhost/api/admin/calendar", { headers: cookie })),
    );
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/calendar", () => {
  beforeEach(() => {
    state.role = "pentadbir";
  });

  it("writes through the RPC, with the school's own session", async () => {
    const res = await PATCH(
      patch({
        weekNo: 34,
        startDate: "2026-10-19",
        endDate: "2026-10-23",
        label: "Minggu PTS",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(1);
    const { name, args } = state.rpcCalls[0] as { name: string; args: Record<string, unknown> };
    expect(name).toBe("admin_set_calendar_week");
    expect(args).toMatchObject({
      p_school: SCHOOL_ID,
      p_session: "2026/2027",
      p_week_no: 34,
      p_start_date: "2026-10-19",
      p_end_date: "2026-10-23",
      p_label: "Minggu PTS",
      p_from_week_no: null,
    });
  });

  it("ignores a session in the body rather than believing it", async () => {
    const res = await PATCH(
      patch({
        weekNo: 34,
        startDate: "2026-10-19",
        endDate: "2026-10-23",
        // Half the primary key. The schema has no such field, so zod drops it —
        // the assertion is that `p_session` is still the school's own.
        session: "1999/2000",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.rpcCalls[0]).toMatchObject({ args: { p_session: "2026/2027" } });
  });

  it("rejects a date that is not a date at all, before any database call", async () => {
    const res = await PATCH(
      patch({ weekNo: 34, startDate: "19-10-2026", endDate: "23/10/2026" }),
    );

    expect(res.status).toBe(422);
    expect(state.rpcCalls).toEqual([]);
  });

  it("rejects a week number outside 1–52", async () => {
    const res = await PATCH(
      patch({ weekNo: 0, startDate: "2026-10-19", endDate: "2026-10-23" }),
    );

    expect(res.status).toBe(422);
    expect(state.rpcCalls).toEqual([]);
  });

  it("refuses to pull numbering back below what the grid already calls that date", async () => {
    // The SQL checks a new anchor only against its neighbours, and the *first*
    // anchor has none — so a declaration whose number is lower than the term
    // start's answer is the one thing it cannot see. `TERM_START` lives in
    // TypeScript, so this is the only place that can: 6 April 2026 is grid week
    // 4 (term starts 16 March), and calling it week 1 would leave week 2
    // meaning 13 April while a date in March still resolved to week 2.
    const res = await PATCH(
      patch({ weekNo: 1, startDate: "2026-04-06", endDate: "2026-04-10" }),
    );

    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Minggu 4");
    expect(state.rpcCalls).toEqual([]);
  });

  it("passes the row being replaced so an edit cannot leave two claiming one date", async () => {
    const res = await PATCH(
      patch({
        weekNo: 36,
        startDate: "2026-10-26",
        endDate: "2026-10-30",
        fromWeekNo: 35,
      }),
    );

    expect(res.status).toBe(200);
    expect(state.rpcCalls[0]).toMatchObject({ args: { p_from_week_no: 35 } });
  });
});

describe("DELETE /api/admin/calendar", () => {
  beforeEach(() => {
    state.role = "pentadbir";
  });

  it("hands the week back to the automatic assignment", async () => {
    const res = await DELETE(deleteRequest("34"));

    expect(res.status).toBe(200);
    expect(state.rpcCalls[0]).toMatchObject({
      name: "admin_clear_calendar_week",
      args: { p_school: SCHOOL_ID, p_session: "2026/2027", p_week_no: 34 },
    });
  });

  it("refuses a week that is not a week, without asking the database", async () => {
    for (const bad of ["", "0", "53", "abc", "1.5"]) {
      state.rpcCalls.length = 0;
      const res = await DELETE(deleteRequest(bad));
      expect(res.status, `weekNo=${bad || "<empty>"}`).toBe(422);
      expect(state.rpcCalls).toEqual([]);
    }
  });
});
