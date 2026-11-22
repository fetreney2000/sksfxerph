// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, type zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadArchiveZip } from "@/lib/client/archive-export";
import { emptyPayload } from "@/lib/schemas/rph";
import type { RphDocument } from "@/lib/types";

vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  supabaseConfigured: false,
}));
vi.mock("fflate", async (original) => {
  const actual = await original<typeof import("fflate")>();
  return {
    ...actual,
    zip: (
      files: Parameters<typeof zipSync>[0],
      _options: unknown,
      cb: (error: null, bytes: Uint8Array) => void,
    ) => cb(null, actual.zipSync(files)),
  };
});

const plan = (id: string, weekNo: number): RphDocument => ({
  id,
  weekNo,
  schoolCode: "SK",
  ownerId: "teacher",
  classIds: ["c"],
  classNames: ["5 Amanah"],
  subjectCode: "BM",
  subjectName: "Bahasa Melayu",
  session: "2026/2027",
  planDate: "2026-10-05",
  slotTime: "07:30",
  slotTimeEnd: "08:30",
  status: "draft",
  payload: {
    ...emptyPayload(),
    objektif: "Murid memahami pelajaran.",
  },
  version: 1,
  createdAt: 0,
  clientUpdatedAt: 0,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ZIP export", () => {
  it.each(["pdf", "docx"] as const)(
    "contains only %s files for every selected plan",
    async (format) => {
      const font = readFileSync(join(process.cwd(), "public/noto-sans-export.woff"));
      const docx = new Uint8Array([80, 75, 3, 4, 1]);
      const fetchMock = vi.fn(async (url: string) =>
        url.startsWith("/noto") ? new Response(font) : new Response(docx),
      );
      vi.stubGlobal("fetch", fetchMock);
      let blob: Blob | undefined;
      URL.createObjectURL = vi.fn((value: Blob | MediaSource) => {
        blob = value as Blob;
        return "blob:test";
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      await downloadArchiveZip(
        [plan("a", 1), plan("b", 2)],
        "Sesi",
        "Guru",
        "Sekolah",
        format,
        () => {},
      );
      expect(blob).toBeDefined();
      if (!blob) throw new Error("ZIP tidak disediakan");
      const zipBlob: Blob = blob;
      const data = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(zipBlob);
      });
      const files = unzipSync(new Uint8Array(data));
      const paths = Object.keys(files);
      expect(paths).toHaveLength(2);
      expect(paths.every((name) => name.endsWith(`.${format}`))).toBe(true);
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/export")).toBe(
        format === "docx",
      );
      expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/noto"))).toBe(
        format === "pdf",
      );
      for (const name of paths.filter((path) => path.endsWith(".pdf"))) {
        expect(new TextDecoder().decode(files[name]?.slice(0, 5))).toBe("%PDF-");
      }
    },
    // Embedding the PDF font is CPU work; under the full suite's parallel load
    // it can take longer than the default five seconds.
    20_000,
  );

  it("does not download an incomplete ZIP when DOCX export fails", async () => {
    const font = readFileSync(join(process.cwd(), "public/noto-sans-export.woff"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("/noto") ? new Response(font) : new Response("failed", { status: 500 }),
      ),
    );
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await expect(
      downloadArchiveZip([plan("a", 1)], "Sesi", "Guru", "Sekolah", "docx", () => {}),
    ).rejects.toThrow("Eksport DOCX gagal");
    expect(clicked).not.toHaveBeenCalled();
  });
});
