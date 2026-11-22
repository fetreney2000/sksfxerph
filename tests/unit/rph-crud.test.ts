import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPayload } from "@/lib/hash";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";

/**
 * POST /api/rph, GET /api/rph/[id] and PATCH /api/rph/[id] - the online-only
 * write path.
 *
 * Reads and writes used to go through IndexedDB first (commit, flush, pull,
 * merge) with the server as a second opinion. Now the server is the only
 * copy: the editor posts explicit saves, and a clash with the teacher's own
 * slot is a 409 naming the existing plan rather than a silent merge.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ?? "unit-test-secret-0123456789abcdef0123456789abcdef";
});

const USER_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_ID = "00000000-0000-4000-8000-000000000006";
const SCHOOL_ID = "99999999-9999-4999-8999-999999999999";
const CLASS_1 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CLASS_2 = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

interface Row {
  id: string;
  owner_id: string;
  school_id: string;
  class_ids: string[] | null;
  subject_code: string;
  session: string;
  week_no: number;
  plan_date: string;
  status: string;
  version: number;
  deleted_at: string | null;
}

const state = vi.hoisted(() => ({
  role: "guru_biasa" as string,
  calls: [] as { table: string; method: string; args: unknown[] }[],
  rows: [] as Row[],
  supervised: [] as string[],
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

function matches(row: Record<string, unknown>, filters: { method: string; args: unknown[] }[]) {
  return filters.every(({ method, args }) => {
    if (method === "eq") {
      const [col, val] = args as [string, unknown];
      return (row as Record<string, unknown>)[col] === val;
    }
    if (method === "neq") {
      const [col, val] = args as [string, unknown];
      return (row as Record<string, unknown>)[col] !== val;
    }
    if (method === "is") {
      const [col, val] = args as [string, unknown];
      return val === null
        ? (row as Record<string, unknown>)[col] == null
        : (row as Record<string, unknown>)[col] === val;
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
      for (const method of ["select", "eq", "neq", "in", "is", "order", "limit"]) {
        chain[method] = record(method);
      }
      const filtered = () =>
        table === "rph_document"
          ? state.rows.filter((r) => matches(r as unknown as Record<string, unknown>, ops))
          : [];
      chain.insert = (body: Record<string, unknown>) => {
        state.calls.push({ table, method: "insert", args: [body] });
        const row = { id: `rph-${state.rows.length + 1}`, ...body } as Row;
        state.rows.push(row);
        return {
          select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }),
        };
      };
      chain.update = (patch: Record<string, unknown>) => {
        state.calls.push({ table, method: "update", args: [patch] });
        return {
          eq: (col: string, val: unknown) => {
            state.calls.push({ table, method: "eq", args: [col, val] });
            ops.push({ method: "eq", args: [col, val] });
            const hit = filtered();
            for (const row of hit) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null });
          },
        };
      };
      chain.delete = () => Promise.resolve({ data: null, error: null });
      chain.maybeSingle = async () => {
        state.calls.push({ table, method: "maybeSingle", args: [] });
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
        if (table === "subject") {
          // Only MAT exists in this mock school - anything else is unknown.
          const asked = ops.find((o) => o.method === "eq" && o.args[0] === "code");
          const code = asked ? String(asked.args[1]) : "";
          return { data: code === "MAT" ? { code } : null, error: null };
        }
        const hit = filtered();
        // Copies, not references: a real database hands back snapshots, and
        // the route reads a version and then bumps it - aliasing the store
        // would double-count the bump.
        return { data: hit[0] ? { ...hit[0] } : null, error: null };
      };
      chain.single = async () => {
        state.calls.push({ table, method: "single", args: [] });
        const hit = filtered();
        return { data: hit[0] ? { ...hit[0] } : null, error: null };
      };
      // biome-ignore lint/suspicious/noThenProperty: a supabase builder is thenable on purpose - every caller reads it with `await … .eq()`, and a mock that is not would await into nothing.
      chain.then = (onOk: unknown, onErr: unknown) => {
        state.calls.push({ table, method: "then", args: [] });
        if (table === "class") {
          return Promise.resolve({
            data: [
              { id: CLASS_1, nama: "1 Bestari" },
              { id: CLASS_2, nama: "2 Bestari" },
            ],
            error: null,
          }).then(onOk as (v: unknown) => unknown, onErr as (e: unknown) => unknown);
        }
        if (table === "subject") {
          return Promise.resolve({ data: [{ code: "MAT" }], error: null }).then(
            onOk as (v: unknown) => unknown,
            onErr as (e: unknown) => unknown,
          );
        }
        if (table === "school_member") {
          // The reviewer's scope read asks for user ids supervised by the
          // caller; anything else on this table is unfiltered noise the route
          // never awaits. schoolIdFor reads through maybeSingle, not here.
          const wantsUsers = ops.some((o) => o.method === "select" && o.args[0] === "user_id");
          if (wantsUsers) {
            return Promise.resolve({
              data: state.supervised.map((user_id) => ({ user_id })),
              error: null,
            }).then(onOk as (v: unknown) => unknown, onErr as (e: unknown) => unknown);
          }
        }
        return Promise.resolve({ data: filtered(), error: null }).then(
          onOk as (v: unknown) => unknown,
          onErr as (e: unknown) => unknown,
        );
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

const { POST } = await import("@/app/api/rph/route");
const { GET: GET_ONE, PATCH, DELETE } = await import("@/app/api/rph/[id]/route");

const VALID_ID = "11111111-1111-4111-8111-111111111111";

function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        cookie: `${SESSION_COOKIE}=${mintSession(USER_ID)}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

function call(
  handler: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  method: string,
  path: string,
  body?: unknown,
  id?: string,
) {
  return handler(req(method, path, body), { params: Promise.resolve({ id: id ?? "" }) });
}

const draft = (over: Partial<Row> = {}): Row => ({
  id: VALID_ID,
  owner_id: USER_ID,
  school_id: SCHOOL_ID,
  class_ids: [CLASS_1],
  subject_code: "MAT",
  session: "2026/2027",
  week_no: 36,
  plan_date: "2026-11-18",
  status: "draft",
  version: 1,
  deleted_at: null,
  ...over,
});

const payload = {
  payload_version: 2,
  fasa_tema: "",
  bidang: "",
  tajuk: "",
  standard_kandungan: "",
  standard_pembelajaran: "",
  objektif: "",
  aktiviti: [],
  kriteria_kejayaan: "",
  refleksi: "",
};

const newPlan = () => ({
  classIds: [CLASS_1],
  subjectCode: "MAT",
  weekNo: 36,
  planDate: "2026-11-18",
  slotTime: "07:30",
  payload,
});

beforeEach(() => {
  state.role = "guru_biasa";
  state.calls.length = 0;
  state.rows = [];
  state.supervised = [];
});

describe("POST /api/rph", () => {
  it("files a draft under the caller's school, session and identity", async () => {
    const res = await call(POST, "POST", "/api/rph", newPlan());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string; version: number };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(1);
    const stored = state.rows.find((r) => r.id === body.id);
    expect(stored).toMatchObject({
      owner_id: USER_ID,
      school_id: SCHOOL_ID,
      session: "2026/2027",
      status: "draft",
      version: 1,
    });
  });

  it("names the existing plan instead of filing a duplicate slot", async () => {
    state.rows = [draft()];

    const res = await call(POST, "POST", "/api/rph", newPlan());

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; clashId: string };
    expect(body.clashId).toBe(VALID_ID);
    expect(state.rows).toHaveLength(1);
  });

  it("refuses a week that does not contain the date", async () => {
    const res = await call(POST, "POST", "/api/rph", { ...newPlan(), weekNo: 35 });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain("Tarikh tidak sepadan");
    expect(state.rows).toHaveLength(0);
  });

  it("allows disjoint class sets on the same day", async () => {
    state.rows = [draft()];

    const res = await call(POST, "POST", "/api/rph", { ...newPlan(), classIds: [CLASS_2] });

    expect(res.status).toBe(200);
    expect(state.rows).toHaveLength(2);
  });

  it("refuses a class that is not the school's", async () => {
    const res = await call(POST, "POST", "/api/rph", {
      ...newPlan(),
      classIds: ["33333333-3333-4333-8333-333333333333"],
    });

    expect(res.status).toBe(422);
    expect(state.rows).toHaveLength(0);
  });

  it("refuses an unknown subject", async () => {
    const res = await call(POST, "POST", "/api/rph", { ...newPlan(), subjectCode: "XYZ" });

    expect(res.status).toBe(422);
    expect(state.rows).toHaveLength(0);
  });

  it("stores a content hash derived from the row, not the request", async () => {
    const res = await call(POST, "POST", "/api/rph", {
      ...newPlan(),
      // Unknown to the schema, so it cannot become the stored value.
      contentHash: "client-supplied",
    });

    expect(res.status).toBe(200);
    const insert = state.calls.find((c) => c.table === "rph_document" && c.method === "insert");
    if (!insert) throw new Error("no insert recorded");
    expect((insert.args[0] as { content_hash: string }).content_hash).toBe(
      hashPayload(payload),
    );
  });

  it("refuses a Guru Besar - they teach nothing to file", async () => {
    state.role = "guru_besar";

    const res = await call(POST, "POST", "/api/rph", newPlan());

    expect(res.status).toBe(403);
  });
});

describe("GET /api/rph/[id]", () => {
  it("returns the caller's own plan", async () => {
    state.rows = [draft()];

    const res = await call(GET_ONE, "GET", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: { id: string } };
    expect(body.item.id).toBe(VALID_ID);
  });

  it("answers 404 for a colleague's plan, without naming it", async () => {
    state.rows = [draft({ owner_id: OTHER_ID })];

    const res = await call(GET_ONE, "GET", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(404);
  });

  it("lets a GPK read an assigned teacher's plan, with the teacher's name", async () => {
    state.role = "gpk";
    state.supervised = [OTHER_ID];
    state.rows = [draft({ owner_id: OTHER_ID })];

    const res = await call(GET_ONE, "GET", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: { id: string }; teacherName: string };
    expect(body.item.id).toBe(VALID_ID);
    expect(typeof body.teacherName).toBe("string");
  });

  it("lets a Guru Besar read any plan in the school", async () => {
    state.role = "guru_besar";
    state.rows = [draft({ owner_id: OTHER_ID })];

    const res = await call(GET_ONE, "GET", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(200);
  });

  it("answers 404 for a GPK outside their assignment", async () => {
    state.role = "gpk";
    state.supervised = [];
    state.rows = [draft({ owner_id: OTHER_ID })];

    const res = await call(GET_ONE, "GET", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(404);
  });

  it("refuses a role with neither the teaching nor the reviewing permission", async () => {
    state.role = "pentadbir";
    state.rows = [draft({ owner_id: OTHER_ID })];

    const res = await call(GET_ONE, "GET", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(403);
  });

  it("refuses a malformed id before the database", async () => {
    const res = await call(GET_ONE, "GET", "/api/rph/bukan-uuid", undefined, "bukan-uuid");

    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/rph/[id]", () => {
  it("saves edits and bumps the version", async () => {
    state.rows = [draft()];

    const res = await call(
      PATCH,
      "PATCH",
      `/api/rph/${VALID_ID}`,
      { planDate: "2026-11-19", payload },
      VALID_ID,
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { version: number }).version).toBe(2);
    const saved = state.rows[0];
    expect(saved).toBeDefined();
    expect(saved?.plan_date).toBe("2026-11-19");
    expect(saved?.version).toBe(2);
  });

  it("refuses a sealed plan", async () => {
    state.rows = [draft({ status: "approved" })];

    const res = await call(PATCH, "PATCH", `/api/rph/${VALID_ID}`, { payload }, VALID_ID);

    expect(res.status).toBe(409);
    expect(state.rows[0]?.version).toBe(1);
  });

  it("refuses to edit a plan already submitted for review", async () => {
    state.rows = [draft({ status: "submitted" })];

    const res = await call(PATCH, "PATCH", `/api/rph/${VALID_ID}`, { payload }, VALID_ID);

    expect(res.status).toBe(409);
    expect(state.rows[0]?.version).toBe(1);
  });

  it("refuses a date that belongs to another week", async () => {
    state.rows = [draft()];

    const res = await call(
      PATCH,
      "PATCH",
      `/api/rph/${VALID_ID}`,
      { planDate: "2026-11-23" },
      VALID_ID,
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain("Tarikh tidak sepadan");
  });

  it("saves an older-session plan when its class set has not changed", async () => {
    state.rows = [draft({ session: "2025/2026" })];

    const res = await call(
      PATCH,
      "PATCH",
      `/api/rph/${VALID_ID}`,
      {
        classIds: [CLASS_1],
        weekNo: 36,
        planDate: "2026-11-18",
        payload,
      },
      VALID_ID,
    );

    expect(res.status).toBe(200);
    expect(state.rows[0]?.version).toBe(2);
  });

  it("records the edited version in the revision history", async () => {
    state.rows = [draft()];

    const res = await call(PATCH, "PATCH", `/api/rph/${VALID_ID}`, { payload }, VALID_ID);

    expect(res.status).toBe(200);
    const revision = state.calls.find(
      (c) => c.table === "rph_revision" && c.method === "insert",
    );
    expect(revision?.args[0]).toMatchObject({
      document_id: VALID_ID,
      version: 2,
      reason: "edit",
      actor_id: USER_ID,
    });
  });

  it("refuses a save based on a version another tab already replaced", async () => {
    state.rows = [draft({ version: 3 })];

    const res = await call(
      PATCH,
      "PATCH",
      `/api/rph/${VALID_ID}`,
      { payload, expectedVersion: 2 },
      VALID_ID,
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("tab lain");
    expect(state.rows[0]?.version).toBe(3);
  });

  it("refuses a move into another plan's slot", async () => {
    state.rows = [draft(), draft({ id: "22222222-2222-4222-8222-222222222222" })];

    const res = await call(
      PATCH,
      "PATCH",
      `/api/rph/${VALID_ID}`,
      // Re-stating the same slot still collides: the other row already holds
      // it, and only the row itself is exempt.
      { planDate: "2026-11-18", payload },
      VALID_ID,
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as { clashId: string }).clashId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("answers 404 for a colleague's plan", async () => {
    state.rows = [draft({ owner_id: OTHER_ID })];

    const res = await call(PATCH, "PATCH", `/api/rph/${VALID_ID}`, { payload }, VALID_ID);

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/rph/[id]", () => {
  it("soft-deletes a draft and writes the audit row", async () => {
    state.rows = [draft()];

    const res = await call(DELETE, "DELETE", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(200);
    expect(state.rows[0]?.deleted_at).not.toBeNull();
    expect(state.calls.some((c) => c.table === "audit_log" && c.method === "insert")).toBe(
      true,
    );
  });

  it("lets a returned plan go - it is a working copy again", async () => {
    state.rows = [draft({ status: "returned" })];

    const res = await call(DELETE, "DELETE", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(200);
    expect(state.rows[0]?.deleted_at).not.toBeNull();
  });

  it("refuses a sealed plan - approval is not the teacher's to undo", async () => {
    state.rows = [draft({ status: "approved" })];

    const res = await call(DELETE, "DELETE", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(409);
    expect(state.rows[0]?.deleted_at).toBeNull();
  });

  it("refuses a plan under review - it may be open on a reviewer's screen", async () => {
    state.rows = [draft({ status: "submitted" })];

    const res = await call(DELETE, "DELETE", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(409);
    expect(state.rows[0]?.deleted_at).toBeNull();
  });

  it("answers 404 for a colleague's plan", async () => {
    state.rows = [draft({ owner_id: OTHER_ID })];

    const res = await call(DELETE, "DELETE", `/api/rph/${VALID_ID}`, undefined, VALID_ID);

    expect(res.status).toBe(404);
  });
});
