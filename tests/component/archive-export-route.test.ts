// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { emptyPayload } from "@/lib/schemas/rph";
import type { RphDocument } from "@/lib/types";

vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  supabaseConfigured: true,
}));

const { downloadArchiveZip } = await import("@/lib/client/archive-export");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("asks the server for a synced DOCX archive instead of exporting each file", async () => {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3])),
  );
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const plan = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "approved",
    payload: emptyPayload(),
    weekNo: 1,
    planDate: "2026-10-05",
    subjectName: "Matematik",
  } as RphDocument;

  await downloadArchiveZip([plan], "Sesi", "Guru", "Sekolah", "docx", () => {});

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  if (!init) throw new Error("no request init");
  expect(url).toBe("/api/export/archive");
  expect(JSON.parse(String(init.body))).toEqual({
    documentIds: [plan.id],
    name: "Sesi",
    format: "docx",
  });
});
