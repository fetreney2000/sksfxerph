import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";

/**
 * GET /api/review/plans - the review tree's single fetch.
 *
 * One light row per in-scope plan (no payload), grouped client-side into
 * Tahun → Guru → Minggu → Senarai. Scope matches the queue: the whole
 * school for a Guru Besar, the assigned teachers for a GPK.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ?? "unit-test-secret-0123456789abcdef0123456789abcdef";
});

const ME = "00000000-0000-4000-8000-000000000002";
const TEACHER_A = "00000000-0000-4000-8000-0000000000a1";
const TEACHER_B = "00000000-0000-4000-8000-0000000000b2";
const SCHOOL_ID = "99999999-9999-4999-8999-999999999999";
const CLASS_1 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

interface MemberRow {
  user_id: string;
  school_id: string;
  supervisor_id: string | null;
  is_active: boolean;
}

interface PlanRow {
  id: string;
  version: number;
  owner_id: string;
  school_id: string;
  class_ids: string[];
  subject_code: string;
  session: string;
  week_no: number;
  plan_date: string;
  slot_time: string | null;
  status: string;
  submitted_at: string | null;
  deleted_at: string | null;
}

const state = vi.hoisted(() => ({
  role: "guru_besar" as string,
  supervised: [] as string[],
  plans: [] as PlanRow[],
}));

function matches(row: Record<string, unknown>, filters: { method: string; args: unknown[] }[]) {
  return filters.every(({ method, args }) => {
    if (method === "eq") {
      const [col, val] = args as [string, unknown];
      return row[col] === val;
    }
    if (method === "in") {
      const [col, vals] = args as [string, unknown[]];
      return (vals as unknown[]).includes(row[col]);
    }
    if (method === "is") {
      const [col, val] = args as [string, unknown];
      return val === null ? row[col] == null : row[col] === val;
    }
    return true;
  });
}

vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

vi.mock("@/lib/server/db", () => ({
  hasAdminCredentials: () => true,
  adminDb: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const ops: { method: string; args: unknown[] }[] = [];
      const record =
        (method: string) =>
        (...args: unknown[]) => {
          ops.push({ method, args });
          return chain;
        };
      for (const method of ["select", "eq", "neq", "in", "is", "order", "limit"]) {
        chain[method] = record(method);
      }
      const members: MemberRow[] = [
        { user_id: ME, school_id: SCHOOL_ID, supervisor_id: null, is_active: true },
        ...state.supervised.map((user_id) => ({
          user_id,
          school_id: SCHOOL_ID,
          supervisor_id: ME,
          is_active: true,
        })),
      ];
      const filtered = () =>
        (table === "rph_document" ? state.plans : members).filter((r) =>
          matches(r as unknown as Record<string, unknown>, ops),
        );
      chain.maybeSingle = async () => {
        if (table === "user") {
          return {
            data: {
              id: ME,
              username: "reviewer",
              full_name: "Guru Besar",
              email: null,
              role: state.role,
              is_active: true,
              password_changed_at: new Date(0).toISOString(),
            },
            error: null,
          };
        }
        if (table === "school_setting") {
          return { data: { current_session: "2026/2027" }, error: null };
        }
        const hit = filtered();
        return { data: hit[0] ? { ...hit[0] } : null, error: null };
      };
      // biome-ignore lint/suspicious/noThenProperty: a supabase builder is thenable on purpose - every caller reads it with `await … .eq()`, and a mock that is not would await into nothing.
      chain.then = (onOk: unknown, onErr: unknown) => {
        if (table === "class") {
          return Promise.resolve({
            data: [{ id: CLASS_1, nama: "5 Amanah" }],
            error: null,
          }).then(onOk as (v: unknown) => unknown, onErr as (e: unknown) => unknown);
        }
        return Promise.resolve({ data: filtered().map((r) => ({ ...r })), error: null }).then(
          onOk as (v: unknown) => unknown,
          onErr as (e: unknown) => unknown,
        );
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

const { GET } = await import("@/app/api/review/plans/route");

function req(): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/review/plans", {
      headers: { cookie: `${SESSION_COOKIE}=${mintSession(ME)}` },
    }),
  );
}

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4111-8111-222222222222";

const plan = (over: Partial<PlanRow> = {}): PlanRow => ({
  id: VALID_ID,
  version: 1,
  owner_id: TEACHER_A,
  school_id: SCHOOL_ID,
  class_ids: [CLASS_1],
  subject_code: "MAT",
  session: "2026/2027",
  week_no: 36,
  plan_date: "2026-11-18",
  slot_time: "07:30",
  status: "submitted",
  submitted_at: "2026-11-18T08:00:00.000Z",
  deleted_at: null,
  ...over,
});

beforeEach(() => {
  state.role = "guru_besar";
  state.supervised = [];
  state.plans = [];
});

describe("GET /api/review/plans", () => {
  it("gives a Guru Besar the whole school's plans, without bodies", async () => {
    state.plans = [plan(), plan({ id: OTHER_ID, owner_id: TEACHER_B })];

    const res = await GET(req());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[]; assigned: boolean };
    expect(body.assigned).toBe(true);
    expect(body.items).toHaveLength(2);
    const first = body.items[0] as Record<string, unknown>;
    expect(first.id).toBe(VALID_ID);
    expect(first.teacherId).toBe(TEACHER_A);
    expect(first.className).toBe("5 Amanah");
    expect(first.weekNo).toBe(36);
    expect("payload" in first).toBe(false);
  });

  it("scopes a GPK to their supervised teachers", async () => {
    state.role = "gpk";
    state.supervised = [TEACHER_A];
    state.plans = [plan(), plan({ id: OTHER_ID, owner_id: TEACHER_B })];

    const res = await GET(req());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { teacherId: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.teacherId).toBe(TEACHER_A);
  });

  it("tells a GPK with no assignment apart from an empty school", async () => {
    state.role = "gpk";
    state.supervised = [];
    state.plans = [plan()];

    const res = await GET(req());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; assigned: boolean };
    expect(body).toEqual({ items: [], assigned: false });
  });

  it("refuses a teacher - reviewing is not their permission", async () => {
    state.role = "guru_biasa";
    state.plans = [plan()];

    const res = await GET(req());

    expect(res.status).toBe(403);
  });
});
