import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPayload } from "@/lib/schemas/rph";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";

/**
 * PATCH /api/templates, and the payload it carries.
 *
 * The payload was absent from this route's schema, so a template could be
 * renamed but never *changed* — and a template's whole value is the plan it
 * starts from. Now that the penyunting saves a template back, the two halves
 * of that contract are worth pinning: a payload that arrives is written, and
 * one that does not leaves the plan exactly as it was, so a rename cannot
 * blank the thing it was supposed to leave alone.
 */

const OWNER_ID = "00000000-0000-4000-8000-000000000002";
const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID = "99999999-9999-4999-8999-999999999999";

const store = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[] }));

// The route authenticates the session cookie by reading `erph.user`, so the
// stand-in client has to answer for that table as well as the two below it.
vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

vi.mock("@/lib/server/db", () => ({
  hasAdminCredentials: () => true,
  adminDb: () => ({
    from(table: string) {
      // Filtered lazily, so `canEdit`'s own `.eq("id", …)` decides which
      // template this chain answers for. A fixture that returned the owner's
      // row for every id would make the ownership check pass vacuously.
      const filters: Record<string, unknown> = {};
      const row = () => {
        if (table === "user") {
          return {
            id: OWNER_ID,
            username: "suhaila",
            full_name: "Suhaila binti Hassan",
            email: null,
            role: "guru_biasa",
            is_active: true,
            password_changed_at: new Date(0).toISOString(),
          };
        }
        if (table === "school_member") return { school_id: SCHOOL_ID };
        if (table === "rph_template") {
          const id = filters.id;
          return {
            id,
            owner_id: id === TEMPLATE_ID ? OWNER_ID : "22222222-2222-4222-8222-222222222222",
            school_id: SCHOOL_ID,
          };
        }
        return null;
      };
      const chain = {
        select: () => chain,
        ilike: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        limit: () => chain,
        maybeSingle: async () => ({ data: row(), error: null }),
        update: (patch: Record<string, unknown>) => {
          store.updates.push(patch);
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  }),
}));

const { PATCH } = await import("@/app/api/templates/route");

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/templates", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${mintSession(OWNER_ID)}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

const base = {
  id: TEMPLATE_ID,
  title: "Matematik Tahun 5 · SK 3.1",
  subjectCode: "MAT",
  tahap: "Tahun 5",
  curriculum: "KSSR",
  visibility: "school",
};

beforeEach(() => {
  store.updates.length = 0;
});

describe("PATCH /api/templates", () => {
  it("writes the plan it is sent", async () => {
    const payload = { ...emptyPayload(), objektif: "Objektif yang diperbetulkan" };
    const res = await PATCH(patchRequest({ ...base, payload }));

    expect(res.status).toBe(200);
    expect(store.updates[0]?.payload).toMatchObject({
      objektif: "Objektif yang diperbetulkan",
    });
  });

  it("leaves the plan alone when a rename sends none", async () => {
    const res = await PATCH(patchRequest({ ...base, title: "Nama baharu" }));

    expect(res.status).toBe(200);
    // The key is absent, not present-and-undefined: the update is a partial,
    // and a column written with nothing blanks it.
    expect(store.updates[0]).not.toHaveProperty("payload");
  });

  it("carries the rest of the row either way", async () => {
    await PATCH(patchRequest({ ...base, payload: emptyPayload() }));

    expect(store.updates[0]).toMatchObject({
      title: "Matematik Tahun 5 · SK 3.1",
      subject_code: "MAT",
      tahap: "Tahun 5",
      curriculum: "KSSR",
      visibility: "school",
    });
  });

  it("refuses a template that is not the caller's", async () => {
    const foreign = "22222222-2222-4222-8222-222222222222";
    const res = await PATCH(patchRequest({ ...base, id: foreign }));

    expect(res.status).toBe(404);
    expect(store.updates).toHaveLength(0);
  });
});
