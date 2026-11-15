import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";

/**
 * GET / POST / DELETE /api/rpt — a teacher's RPT links, plus their appearance
 * on the reviewer's roster (`GET /api/pantau/teachers`).
 *
 * The file bytes never enter this app: an RPT lives in the teacher's Drive
 * and only the link is stored, so the one thing worth proving at the boundary
 * is who may write one (a plan-writing role — the Guru Besar teaches nothing
 * and holds no `rph`) and who may read one (the teacher themself, plus exactly
 * the reviewers `may_supervise` already grants). The second half is proved by
 * asserting the *query*, not just the rows: the roster must ask for links of
 * its own scoped teachers and nobody else.
 */

// The session cookie cannot be minted without the secret once Supabase counts
// as configured — the same gate every other route test trips over.
vi.hoisted(() => {
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ?? "unit-test-secret-0123456789abcdef0123456789abcdef";
});

const TEACHER_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_TEACHER_ID = "00000000-0000-4000-8000-000000000006";
const SCHOOL_ID = "99999999-9999-4999-8999-999999999999";

interface RptRow {
  id: string;
  school_id: string;
  owner_id: string;
  session: string;
  title: string;
  url: string;
  created_at: string;
  updated_at: string;
}

const state = vi.hoisted(() => ({
  /** Who is signing in. The write gate turns on this. */
  role: "guru_biasa" as string,
  // Literal, not TEACHER_ID: hoisted state initialises before the consts below.
  userId: "00000000-0000-4000-8000-000000000002",
  /** Every builder call, so a test can assert the scope, not just the rows. */
  calls: [] as { table: string; method: string; args: unknown[] }[],
  rows: [] as RptRow[],
  /** Rows the `pantau_teachers` RPC answers with (already scoped by the RPC). */
  pantauRows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

function matches(row: Record<string, unknown>, filters: { method: string; args: unknown[] }[]) {
  return filters.every(({ method, args }) => {
    if (method === "eq") {
      const [col, val] = args as [string, unknown];
      return row[col] === val;
    }
    if (method === "ilike") {
      const [col, pattern] = args as [string, string];
      const cell = String(row[col] ?? "");
      // The route escapes LIKE metacharacters, so the pattern is literal
      // apart from no wildcards at all — a plain case-insensitive compare.
      const literal = pattern.replace(/\\(.)/g, "$1");
      return cell.toLowerCase() === literal.toLowerCase();
    }
    if (method === "in") {
      const [col, vals] = args as [string, unknown[]];
      return (vals as unknown[]).includes(row[col]);
    }
    return true;
  });
}

vi.mock("@/lib/server/db", () => ({
  hasAdminCredentials: () => true,
  adminDb: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const ops: { method: string; args: unknown[] }[] = [];
      const record =
        (method: string) =>
        (...args: unknown[]) => {
          state.calls.push({ table, method, args });
          ops.push({ method, args });
          return chain;
        };
      for (const method of ["select", "eq", "neq", "in", "is", "order", "limit", "ilike"]) {
        chain[method] = record(method);
      }
      const filtered = () =>
        table === "rpt_link"
          ? state.rows.filter((r) => matches(r as unknown as Record<string, unknown>, ops))
          : [];
      chain.insert = (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        state.calls.push({ table, method: "insert", args: [rows] });
        const list = Array.isArray(rows) ? rows : [rows];
        const inserted = list.map((r, i) => ({
          id: `rpt-${state.rows.length + i + 1}`,
          school_id: "",
          owner_id: "",
          session: "",
          title: "",
          url: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...r,
        })) as RptRow[];
        state.rows.push(...inserted);
        return {
          select: () => ({
            single: async () => ({ data: { id: inserted[0]?.id }, error: null }),
          }),
        };
      };
      chain.update = (patch: Record<string, unknown>) => {
        state.calls.push({ table, method: "update", args: [patch] });
        return {
          eq: (col: string, val: unknown) => {
            state.calls.push({ table, method: "eq", args: [col, val] });
            ops.push({ method: "eq", args: [col, val] });
            return {
              eq: (col2: string, val2: unknown) => {
                state.calls.push({ table, method: "eq", args: [col2, val2] });
                ops.push({ method: "eq", args: [col2, val2] });
                return {
                  select: () => ({
                    single: async () => {
                      const hit = filtered();
                      for (const row of hit) Object.assign(row, patch);
                      return { data: hit[0] ? { id: hit[0].id } : null, error: null };
                    },
                  }),
                };
              },
            };
          },
        };
      };
      chain.delete = () => {
        state.calls.push({ table, method: "delete", args: [] });
        return {
          eq: (col: string, val: unknown) => {
            state.calls.push({ table, method: "eq", args: [col, val] });
            ops.push({ method: "eq", args: [col, val] });
            return {
              eq: (col2: string, val2: unknown) => {
                state.calls.push({ table, method: "eq", args: [col2, val2] });
                ops.push({ method: "eq", args: [col2, val2] });
                for (let i = state.rows.length - 1; i >= 0; i--) {
                  if (
                    matches(state.rows[i] as unknown as Record<string, unknown>, ops) &&
                    table === "rpt_link"
                  ) {
                    state.rows.splice(i, 1);
                  }
                }
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      };
      chain.maybeSingle = async () => {
        state.calls.push({ table, method: "maybeSingle", args: [] });
        if (table === "user") {
          return {
            data: {
              id: state.userId,
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
        const hit = filtered();
        return { data: hit[0] ?? null, error: null };
      };
      chain.single = async () => {
        state.calls.push({ table, method: "single", args: [] });
        const hit = filtered();
        return { data: hit[0] ?? null, error: null };
      };
      // biome-ignore lint/suspicious/noThenProperty: a supabase builder is thenable on purpose — every caller reads it with `await … .eq()`, and a mock that is not would await into nothing.
      chain.then = (onOk: unknown, onErr: unknown) => {
        state.calls.push({ table, method: "then", args: [] });
        return Promise.resolve({ data: filtered(), error: null }).then(
          onOk as (v: unknown) => unknown,
          onErr as (e: unknown) => unknown,
        );
      };
      return chain;
    },
    rpc: (name: string) => {
      state.calls.push({ table: `rpc:${name}`, method: "rpc", args: [] });
      if (name === "pantau_teachers") {
        return Promise.resolve({ data: state.pantauRows, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const { GET, POST, DELETE } = await import("@/app/api/rpt/route");
const { GET: GET_TEACHERS } = await import("@/app/api/pantau/teachers/route");

function authed(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        cookie: `${SESSION_COOKIE}=${mintSession(state.userId)}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

function seedRows(): void {
  state.rows = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      school_id: SCHOOL_ID,
      owner_id: TEACHER_ID,
      session: "2026/2027",
      title: "RPT Matematik Tahun 5",
      url: "https://drive.google.com/file/d/abc",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    },
  ];
}

beforeEach(() => {
  state.role = "guru_biasa";
  state.userId = TEACHER_ID;
  state.calls.length = 0;
  state.pantauRows = [];
  seedRows();
});

describe("GET /api/rpt", () => {
  it("lists the caller's own links for the session", async () => {
    const res = await GET(authed("GET", "/api/rpt"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { title: string }[] };
    expect(body.items.map((i) => i.title)).toEqual(["RPT Matematik Tahun 5"]);
  });

  it("does not list another teacher's links", async () => {
    const only = state.rows[0];
    expect(only).toBeDefined();
    if (only) only.owner_id = OTHER_TEACHER_ID;

    const res = await GET(authed("GET", "/api/rpt"));

    expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
  });
});

describe("POST /api/rpt", () => {
  it("stores a Drive link", async () => {
    const res = await POST(
      authed("POST", "/api/rpt", {
        title: "RPT Sains Tahun 4",
        url: "https://docs.google.com/document/d/xyz",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.rows.some((r) => r.title === "RPT Sains Tahun 4")).toBe(true);
  });

  it("updates the link when the same title is attached again", async () => {
    const res = await POST(
      authed("POST", "/api/rpt", {
        title: "rpt matematik tahun 5",
        url: "https://drive.google.com/file/d/updated",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.url).toBe("https://drive.google.com/file/d/updated");
  });

  it("refuses a non-Drive URL", async () => {
    const res = await POST(
      authed("POST", "/api/rpt", { title: "RPT Sains", url: "https://example.com/rpt.pdf" }),
    );

    expect(res.status).toBe(422);
    expect(state.rows).toHaveLength(1);
  });

  it("refuses a non-https URL and an empty title", async () => {
    const http = await POST(
      authed("POST", "/api/rpt", { title: "RPT Sains", url: "http://drive.google.com/x" }),
    );
    expect(http.status).toBe(422);

    const blank = await POST(
      authed("POST", "/api/rpt", { title: "  ", url: "https://drive.google.com/x" }),
    );
    expect(blank.status).toBe(422);
  });

  it("refuses a Guru Besar — they teach nothing to attach", async () => {
    state.role = "guru_besar";

    const res = await POST(
      authed("POST", "/api/rpt", {
        title: "RPT Sains",
        url: "https://drive.google.com/file/d/abc",
      }),
    );

    expect(res.status).toBe(403);
    expect(state.rows).toHaveLength(1);
  });
});

describe("DELETE /api/rpt", () => {
  it("removes the caller's own link", async () => {
    const res = await DELETE(
      authed("DELETE", "/api/rpt?id=11111111-1111-4111-8111-111111111111"),
    );

    expect(res.status).toBe(200);
    expect(state.rows).toHaveLength(0);
  });

  it("refuses a malformed id before touching the database", async () => {
    const before = state.calls.filter((c) => c.table === "rpt_link").length;

    const res = await DELETE(authed("DELETE", "/api/rpt?id=bukan-uuid"));

    expect(res.status).toBe(400);
    expect(state.calls.filter((c) => c.table === "rpt_link").length).toBe(before);
  });
});

describe("GET /api/pantau/teachers — RPT decoration", () => {
  const teacherRow = (userId: string) => ({
    user_id: userId,
    full_name: userId === TEACHER_ID ? "Suhaila" : "Lain",
    role: "guru_biasa",
    week_total: 5,
    week_done: 5,
    session_total: 5,
    session_done: 5,
    returned_total: 0,
    fixed_total: 0,
    last_reviewed_at: null,
    classes: "5 Amanah",
  });

  it("attaches each scoped teacher's links", async () => {
    state.role = "gpk";
    state.pantauRows = [teacherRow(TEACHER_ID)];

    const res = await GET_TEACHERS(authed("GET", "/api/pantau/teachers?first=36&last=36"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { userId: string; rptLinks: { title: string; url: string }[] }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.rptLinks).toEqual([
      { title: "RPT Matematik Tahun 5", url: "https://drive.google.com/file/d/abc" },
    ]);
  });

  it("asks for links of its own scoped teachers and nobody else", async () => {
    state.role = "guru_besar";
    // The other teacher's link exists in the table but the RPC did not scope
    // them to this reviewer — it must neither be queried nor returned.
    state.rows.push({
      id: "rpt-2",
      school_id: SCHOOL_ID,
      owner_id: OTHER_TEACHER_ID,
      session: "2026/2027",
      title: "RPT Orang Lain",
      url: "https://drive.google.com/file/d/other",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    });
    state.pantauRows = [teacherRow(TEACHER_ID)];

    const res = await GET_TEACHERS(authed("GET", "/api/pantau/teachers?first=36&last=36"));

    expect(res.status).toBe(200);
    const inCalls = state.calls.filter((c) => c.table === "rpt_link" && c.method === "in");
    expect(inCalls).toHaveLength(1);
    expect(inCalls[0]?.args).toEqual(["owner_id", [TEACHER_ID]]);
    const body = (await res.json()) as {
      items: { rptLinks: { title: string }[] }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.rptLinks.map((l) => l.title)).toEqual(["RPT Matematik Tahun 5"]);
  });
});
