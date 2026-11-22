import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weekMondayIso } from "@/lib/config";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";
import { invalidateCalendarCache } from "@/lib/server/calendar";

/**
 * GET /api/queue - the week mode (`?week=N`) behind the reviewer's backdated
 * RPH browser.
 *
 * The pending queue filters by status, so a plan a teacher never submitted was
 * invisible to the one person who may need to reach it. Week mode asks for a
 * whole school week instead - every status - while keeping exactly the same
 * scope rules (whole school for the Guru Besar, supervised teachers for a GPK)
 * and the same soft-delete exclusion. What must never change silently is the
 * default mode: the ordinary queue keeps its `status` filter, its ordering and
 * its first page of 50, while `total` reports the real queue size.
 *
 * Week mode matches by WHEN TAUGHT (the week's Monday..Sunday under the
 * school's current declarations), never by the stamped `week_no`: a plan filed
 * under grid numbering goes stale the moment the administrator declares those
 * dates another number, and the picker - which labels every week by its dates
 * - would offer a week whose plans it then could not find.
 */

// The session cookie cannot be minted without the secret once Supabase counts
// as configured - the same gate every other route test trips over.
vi.hoisted(() => {
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ?? "unit-test-secret-0123456789abcdef0123456789abcdef";
});

const TEACHER_ID = "00000000-0000-4000-8000-000000000002";
const GPK_ID = "00000000-0000-4000-8000-000000000003";
const SCHOOL_ID = "99999999-9999-4999-8999-999999999999";

const state = vi.hoisted(() => ({
  /** Who is signing in. The route's whole answer turns on this. */
  role: "gpk" as string,
  /** Every builder call, so a test can assert the filters, not just the rows. */
  calls: [] as { table: string; method: string; args: unknown[] }[],
  /** Rows the awaited `rph_document` read answers with. */
  rows: [] as Record<string, unknown>[],
  /** Exact count `rph_document` reports, when a test overrides it. */
  total: null as number | null,
  /** Declared calendar weeks the route's date arithmetic reads through. */
  anchors: [] as {
    week_no: number;
    start_date: string;
    label: string | null;
    session: string;
  }[],
  /** Teachers supervised by the signing-in GPK. Empty means unassigned. */
  supervised: ["00000000-0000-4000-8000-000000000002"] as string[],
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
      // is the final `{ data, error }`. Made thenable so `await … .eq().in()`
      // and `await … .limit().maybeSingle()` both work without knowing which
      // path a handler happens to take.
      const chain: Record<string, unknown> = {};
      const record =
        (method: string) =>
        (...args: unknown[]) => {
          state.calls.push({ table, method, args });
          return chain;
        };
      for (const method of [
        "select",
        "eq",
        "neq",
        "in",
        "is",
        "order",
        "limit",
        "range",
        "lt",
        "gte",
        "lte",
      ]) {
        chain[method] = record(method);
      }
      chain.maybeSingle = async () => {
        state.calls.push({ table, method: "maybeSingle", args: [] });
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
      };
      // biome-ignore lint/suspicious/noThenProperty: a supabase builder is thenable on purpose - every caller reads it with `await … .eq()`, and a mock that is not would await into nothing.
      chain.then = (onOk: unknown, onErr: unknown) => {
        state.calls.push({ table, method: "then", args: [] });
        const answer =
          table === "rph_document"
            ? { data: state.rows, error: null, count: state.total ?? state.rows.length }
            : table === "class"
              ? {
                  data: [
                    { id: "class-1", nama: "1 Bestari" },
                    { id: "class-2", nama: "2 Bestari" },
                  ],
                  error: null,
                }
              : table === "academic_calendar"
                ? { data: state.anchors, error: null }
                : table === "rph_review"
                  ? { data: [], error: null }
                  : // The GPK scope lookup selects `user_id` from school_member.
                    { data: state.supervised.map((user_id) => ({ user_id })), error: null };
        return Promise.resolve(answer).then(
          onOk as (v: unknown) => unknown,
          onErr as (e: unknown) => unknown,
        );
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

const { GET } = await import("@/app/api/queue/route");

function get(search = ""): NextRequest {
  const who = state.role === "gpk" ? GPK_ID : TEACHER_ID;
  return new NextRequest(
    new Request(`http://localhost/api/queue${search}`, {
      headers: { cookie: `${SESSION_COOKIE}=${mintSession(who)}` },
    }),
  );
}

/** The builder calls aimed at one table, as "method" strings. */
const callsOn = (table: string, method?: string) =>
  state.calls.filter((c) => c.table === table && (method === undefined || c.method === method));

const docCalls = () =>
  state.calls
    .filter((c) => c.table === "rph_document")
    .map((c) => `${c.method}(${JSON.stringify(c.args)})`);

beforeEach(() => {
  state.role = "gpk";
  state.calls.length = 0;
  state.anchors = [];
  state.supervised = [TEACHER_ID];
  state.total = null;
  // `loadCalendarAnchors` caches per school: without this, one test's
  // declarations leak into the next test's date arithmetic.
  invalidateCalendarCache();
  state.rows = [
    {
      id: "doc-draft",
      version: 1,
      status: "draft",
      plan_date: "2026-10-13",
      slot_time: "07:30",
      payload: {},
      submitted_at: null,
      owner: { full_name: "Aminah Binti Abu" },
      class_ids: ["class-1"],
      subject: { nama: "Bahasa Melayu" },
    },
    {
      id: "doc-approved",
      version: 3,
      status: "approved",
      plan_date: "2026-10-14",
      slot_time: "08:30",
      payload: {},
      submitted_at: "2026-10-14T01:00:00.000Z",
      owner: { full_name: "Aminah Binti Abu" },
      class_ids: ["class-1", "class-2", "class-gone"],
      subject: { nama: "Matematik" },
    },
  ];
});

describe("GET /api/queue - default mode", () => {
  it("keeps the pending queue's filters, order and first page of 50", async () => {
    const res = await GET(get());

    expect(res.status).toBe(200);
    const filters = docCalls().filter((c) => !c.startsWith("select("));
    expect(filters).toContain('eq(["school_id","99999999-9999-4999-8999-999999999999"])');
    expect(filters).toContain('eq(["status","submitted"])');
    expect(filters).toContain('is(["deleted_at",null])');
    expect(filters).toContain('order(["submitted_at",{"ascending":true}])');
    expect(filters).toContain("range([0,49])");
    // Current-week plans are not decidable yet; they must not inflate the
    // badge or the work list.
    expect(filters.some((c) => c.startsWith('lt(["plan_date"'))).toBe(true);
    // Nor is the queue limited to the current school year: prior-session
    // pending work is still work.
    expect(filters.some((c) => c.startsWith('eq(["session"'))).toBe(false);
    expect(filters.some((c) => c.includes("week_no"))).toBe(false);
  });

  it("pages the queue and reports the exact total", async () => {
    state.total = 120;
    const res = await GET(get("?offset=50&limit=50"));

    expect(res.status).toBe(200);
    expect(docCalls().some((c) => c === "range([50,99])")).toBe(true);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(120);
  });

  it("refuses a negative offset or an oversized page", async () => {
    expect((await GET(get("?offset=-1"))).status).toBe(400);
    expect((await GET(get("?limit=500"))).status).toBe(400);
  });

  it("excludes soft-deleted plans from the pending queue too", async () => {
    await GET(get());
    expect(docCalls().some((c) => c.startsWith('is(["deleted_at",null])'))).toBe(true);
  });
});

describe("GET /api/queue - week mode", () => {
  /** Monday..Sunday the route should ask for, computed the way the route does. */
  const weekRange = (week: number, anchors: { weekNo: number; startDate: string }[] = []) => {
    const monday = weekMondayIso(week, anchors);
    const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { monday, sunday };
  };

  it("browses the whole week: every status, by plan date, with a higher cap", async () => {
    const res = await GET(get("?week=2"));

    expect(res.status).toBe(200);
    const filters = docCalls().filter((c) => !c.startsWith("select("));
    const { monday, sunday } = weekRange(2);
    expect(filters).toContain(`gte(["plan_date","${monday}"])`);
    expect(filters).toContain(`lte(["plan_date","${sunday}"])`);
    // The stamped number is never consulted: after a declaration it is stale.
    expect(filters.some((c) => c.includes("week_no"))).toBe(false);
    // No status filter - a draft and an approved plan both belong to the week.
    expect(filters.some((c) => c.startsWith('eq(["status"'))).toBe(false);
    expect(filters).toContain('order(["plan_date",{"ascending":true}])');
    expect(filters).toContain("range([0,199])");

    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toEqual(["doc-draft", "doc-approved"]);
  });

  it("finds a plan stamped under grid numbering after a declaration renumbers it", async () => {
    // The plan was filed when the grid called 19 Oct week 32; the school has
    // since declared those dates week 34. The stale stamp stays on the row -
    // the browse must not ask for it.
    state.anchors = [
      { week_no: 34, start_date: "2026-10-19", label: null, session: "2026/2027" },
    ];
    state.rows = [
      {
        id: "doc-stale",
        version: 1,
        status: "submitted",
        week_no: 32,
        plan_date: "2026-10-20",
        slot_time: "07:30",
        payload: {},
        submitted_at: "2026-10-21T01:00:00.000Z",
        owner: { full_name: "Aminah Binti Abu" },
        class_ids: ["class-1"],
        subject: { nama: "Bahasa Melayu" },
      },
    ];

    const res = await GET(get("?week=34"));

    expect(res.status).toBe(200);
    const filters = docCalls().filter((c) => !c.startsWith("select("));
    expect(filters).toContain('gte(["plan_date","2026-10-19"])');
    expect(filters).toContain('lte(["plan_date","2026-10-25"])');
    expect(filters.some((c) => c.includes("week_no"))).toBe(false);
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toEqual(["doc-stale"]);
  });

  it("still excludes soft-deleted plans from a browsed week", async () => {
    await GET(get("?week=2"));
    expect(docCalls().some((c) => c.startsWith('is(["deleted_at",null])'))).toBe(true);
  });

  it("refuses a week that is not a number in 1–53", async () => {
    const res = await GET(get("?week=abc"));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Minggu tidak sah");
    // Never asked the database for a week it already knows is nonsense.
    expect(callsOn("rph_document")).toEqual([]);
  });

  it("refuses a week outside the school-year bounds", async () => {
    for (const bad of ["0", "54", "1.5", "-2"]) {
      const res = await GET(get(`?week=${bad}`));
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/queue - who may ask, and for whom", () => {
  it("refuses a Guru Biasa before reading anything", async () => {
    state.role = "guru_biasa";

    const res = await GET(get("?week=2"));

    expect(res.status).toBe(403);
    expect(callsOn("rph_document")).toEqual([]);
  });

  it("scopes a GPK's browsed week to their supervised teachers", async () => {
    await GET(get("?week=2"));

    const scope = docCalls().find((c) => c.startsWith("in("));
    expect(scope).toBe('in(["owner_id",["00000000-0000-4000-8000-000000000002"]])');
  });

  it("does not scope the Guru Besar - the whole school's week", async () => {
    state.role = "guru_besar";

    await GET(get("?week=2"));

    expect(docCalls().some((c) => c.startsWith("in("))).toBe(false);
  });

  it("says when a GPK has no supervised teachers, instead of an empty week", async () => {
    state.supervised = [];

    const res = await GET(get("?week=2"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; assigned: boolean };
    expect(body.items).toEqual([]);
    expect(body.assigned).toBe(false);
    // The query was built but never run: a builder records its chain on the
    // way down, so the proof it never executed is the missing terminal read.
    expect(callsOn("rph_document", "then")).toEqual([]);
    expect(callsOn("rph_document", "order")).toEqual([]);
  });

  it("marks the week assigned when teachers are supervised", async () => {
    const res = await GET(get("?week=2"));

    expect(((await res.json()) as { assigned: boolean }).assigned).toBe(true);
  });
});

describe("GET /api/queue - row shaping", () => {
  it("joins every class of a plan into one label, dropping unknown class ids", async () => {
    const res = await GET(get("?week=2"));

    const body = (await res.json()) as {
      items: { id: string; className: string; status: string }[];
    };
    expect(body.items.find((i) => i.id === "doc-approved")?.className).toBe(
      "1 Bestari, 2 Bestari",
    );
    // Status travels through untouched - the page needs it to know which rows
    // are decidable and which are view-only.
    expect(body.items.find((i) => i.id === "doc-draft")?.status).toBe("draft");
  });
});
