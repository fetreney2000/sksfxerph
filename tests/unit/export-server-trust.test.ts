import { strFromU8, unzipSync } from "fflate";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPayload } from "@/lib/schemas/rph";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
});

const USER_ID = "00000000-0000-4000-8000-000000000002";

const state = vi.hoisted(() => ({
  uploads: [] as { path: string; bytes: number }[],
  audits: [] as Record<string, unknown>[],
  removals: [] as string[],
  uploadError: false,
  auditError: false,
}));

const storedPayload = {
  ...emptyPayload(),
  standard_kandungan: "STORED SK",
  standard_pembelajaran: "STORED SP",
  objektif: "STORED OBJECTIVE",
  kriteria_kejayaan: "STORED KRITERIA",
  aktiviti: [{ nama: "STORED ACTIVITY", sub: false }],
  refleksi: "STORED REFLECTION",
};

vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  supabaseConfigured: true,
}));

vi.mock("@/lib/server/auth/guard", () => ({
  requireUser: async () => ({
    user: { id: USER_ID, fullName: "Guru Sebenar", role: "guru_biasa" },
  }),
}));

vi.mock("@/lib/server/school", () => ({
  resolveSchool: async () => ({ id: "school-1", school: { name: "Sekolah Sebenar" } }),
}));

vi.mock("@/lib/server/export-document", () => ({
  loadExportDocument: async () => ({
    ok: true,
    doc: {
      id: "11111111-1111-4111-8111-111111111111",
      schoolId: "school-1",
      ownerId: USER_ID,
      status: "approved",
      version: 3,
      payload: storedPayload,
      session: "2026/2027",
      weekNo: 36,
      planDate: "2026-11-18",
      slotTime: "07:30",
      slotTimeEnd: "08:35",
      className: "5 Sebenar",
      subjectName: "Matematik",
      teacherName: "Guru Sebenar",
    },
    seal: {
      envelope: { v: 1 },
      signature: "sig",
      publicKey: "key",
      alg: "ES256",
      signedAt: "2026-11-20T08:00:00.000Z",
      signerName: "GPK Sebenar",
      signerTitle: "Penolong Kanan HEM",
    },
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          state.uploads.push({ path, bytes: bytes.byteLength });
          return { error: state.uploadError ? { message: "upload failed" } : null };
        },
        remove: async (paths: string[]) => {
          state.removals.push(...paths);
          return { error: null };
        },
      }),
    },
    from: () => ({
      insert: async (body: Record<string, unknown>) => {
        state.audits.push(body);
        return { error: state.auditError ? { message: "audit failed" } : null };
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/export/route");

const forged = {
  ...emptyPayload(),
  standard_kandungan: "FORGED SK",
  standard_pembelajaran: "FORGED SP",
  objektif: "FORGED OBJECTIVE",
  kriteria_kejayaan: "FORGED KRITERIA",
  aktiviti: [{ nama: "FORGED ACTIVITY", sub: false }],
  refleksi: "FORGED REFLECTION",
};

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const baseBody = {
  document_id: "11111111-1111-4111-8111-111111111111",
  payload: forged,
  session: "2026/2027",
  className: "Kelas Palsu",
  subjectName: "Subjek Palsu",
  schoolName: "Sekolah Palsu",
  planDate: "2026-01-01",
  signerName: "Penyemak Palsu",
  signedAt: "2026-01-01T00:00:00.000Z",
  signatureAlg: "FAKE",
  signatureKey: "fake",
};

async function documentXml(res: Response): Promise<string> {
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("no document.xml");
  return strFromU8(xml);
}

beforeEach(() => {
  state.uploads.length = 0;
  state.audits.length = 0;
  state.removals.length = 0;
  state.uploadError = false;
  state.auditError = false;
});

describe("POST /api/export in synced mode", () => {
  it("renders the stored row, not the payload or signer in the body", async () => {
    const res = await POST(request(baseBody));

    expect(res.status).toBe(200);
    const xml = await documentXml(res);
    expect(xml).toContain("STORED OBJECTIVE");
    expect(xml).toContain("5 Sebenar");
    expect(xml).toContain("Matematik");
    expect(xml).toContain("Sekolah Sebenar");
    expect(xml).toContain("GPK Sebenar");
    expect(xml).not.toContain("FORGED");
    expect(xml).not.toContain("Kelas Palsu");
    expect(xml).not.toContain("Sekolah Palsu");
    expect(xml).not.toContain("Penyemak Palsu");
  });

  it("gives every export its own storage path", async () => {
    await POST(request(baseBody));
    await POST(request(baseBody));

    expect(state.uploads).toHaveLength(2);
    expect(state.uploads[0]?.path).not.toBe(state.uploads[1]?.path);
    expect(state.audits[0]?.path).not.toBe(state.audits[1]?.path);
  });

  it("refuses an ad-hoc export with no stored document", async () => {
    const { document_id: _documentId, ...noId } = baseBody;
    const res = await POST(request(noId));

    expect(res.status).toBe(422);
    expect(state.uploads).toHaveLength(0);
  });

  it("fails closed when the stored copy cannot be uploaded", async () => {
    state.uploadError = true;
    const res = await POST(request(baseBody));

    expect(res.status).toBe(500);
    expect(state.audits).toHaveLength(0);
  });

  it("removes the stored copy when its audit row cannot be written", async () => {
    state.auditError = true;
    const res = await POST(request(baseBody));

    expect(res.status).toBe(500);
    expect(state.removals).toHaveLength(1);
    expect(state.removals[0]).toBe(state.uploads[0]?.path);
  });
});
