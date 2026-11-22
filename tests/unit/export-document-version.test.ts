import { describe, expect, it, vi } from "vitest";
import { emptyPayload } from "@/lib/schemas/rph";

/**
 * The approved version is N, but `sahkan_rph()` leaves the document at N+1.
 * Export used to look for the signature at the document's current version and
 * therefore found nothing, so a real sealed export failed in synced mode.
 *
 * These tests pin the lookup to the approval review's `document_version`; the
 * real-database invariant is asserted in `scripts/run_schema.py`.
 */

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const TEACHER_ID = "22222222-2222-4222-8222-222222222222";
const REVIEWER_ID = "33333333-3333-4333-8333-333333333333";
const STRANGER_ID = "44444444-4444-4444-8444-444444444444";
const HASH = "hash-of-the-reviewed-payload";

vi.mock("@/lib/signature", async (original) => ({
  ...(await original<typeof import("@/lib/signature")>()),
  payloadHash: async () => HASH,
  verifySignature: async () => true,
}));

const { loadExportDocument } = await import("@/lib/server/export-document");

type Db = Parameters<typeof loadExportDocument>[0];

interface Call {
  table: string;
  equals: [string, unknown][];
}

function fakeDb(
  rows: {
    document: Record<string, unknown>;
    review: Record<string, unknown> | null;
    signature: Record<string, unknown> | null;
  },
  allowed = false,
): { db: Db; calls: Call[] } {
  const calls: Call[] = [];

  const from = (table: string) => {
    const call: Call = { table, equals: [] };
    calls.push(call);
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        call.equals.push([column, value]);
        return chain;
      },
      is: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (table === "rph_document") return { data: rows.document, error: null };
        if (table === "rph_review") return { data: rows.review, error: null };
        if (table === "rph_signature") return { data: rows.signature, error: null };
        return { data: null, error: null };
      },
    };
    return chain;
  };

  return {
    db: {
      from,
      rpc: async () => ({ data: allowed, error: null }),
    } as unknown as Db,
    calls,
  };
}

function approvedDocument(version = 4) {
  return {
    id: DOC_ID,
    school_id: "school-1",
    owner_id: TEACHER_ID,
    class_ids: [] as string[],
    subject_code: "MAT",
    session: "2026/2027",
    week_no: 10,
    plan_date: "2026-11-16",
    slot_time: "07:30",
    slot_time_end: "08:35",
    status: "approved",
    version,
    reviewed_by: REVIEWER_ID,
    payload: emptyPayload(),
    subject: { nama: "Matematik" },
    owner: { full_name: "Guru Sebenar" },
  };
}

function approval(version: number) {
  return {
    document_version: version,
    reviewer_id: REVIEWER_ID,
    created_at: "2026-11-22T08:00:00.000Z",
  };
}

function signature(version: number) {
  return {
    envelope: {
      v: 1,
      alg: "ES256",
      kid: "key",
      doc: DOC_ID,
      ver: version,
      hash: HASH,
      signer: REVIEWER_ID,
      decision: "sahkan",
      at: "2026-11-22T08:00:00.000Z",
    },
    signature: "signature",
    public_key: "key",
    alg: "ES256",
    signed_at: "2026-11-22T08:00:00.000Z",
    signer_id: REVIEWER_ID,
    signer: { full_name: "Penyemak Sebenar", jawatan: null },
  };
}

describe("approved-plan export signature lookup", () => {
  it("reads the signature at the reviewed version, not the bumped document version", async () => {
    const { db, calls } = fakeDb({
      document: approvedDocument(4),
      review: approval(3),
      signature: signature(3),
    });

    const result = await loadExportDocument(db, DOC_ID, TEACHER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seal?.signerName).toBe("Penyemak Sebenar");

    const signatureCall = calls.find((call) => call.table === "rph_signature");
    expect(signatureCall?.equals).toContainEqual(["document_version", 3]);
    expect(signatureCall?.equals).toContainEqual(["signer_id", REVIEWER_ID]);
    expect(signatureCall?.equals).not.toContainEqual(["document_version", 4]);
  });

  it("does not silently accept a signature left at the post-approval version", async () => {
    const { db } = fakeDb({
      document: approvedDocument(4),
      review: approval(3),
      signature: null,
    });

    const result = await loadExportDocument(db, DOC_ID, TEACHER_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
  });

  it("allows a reviewer in may_supervise scope to produce an audited copy", async () => {
    const { db } = fakeDb(
      {
        document: approvedDocument(4),
        review: approval(3),
        signature: signature(3),
      },
      true,
    );

    const result = await loadExportDocument(db, DOC_ID, REVIEWER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.seal?.signerName).toBe("Penyemak Sebenar");
  });

  it("refuses a caller outside the plan's scope", async () => {
    const { db } = fakeDb(
      {
        document: approvedDocument(4),
        review: approval(3),
        signature: signature(3),
      },
      false,
    );

    const result = await loadExportDocument(db, DOC_ID, STRANGER_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });
});
