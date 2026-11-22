// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { emptyPayload } from "@/lib/schemas/rph";
import type { RphDocument } from "@/lib/types";

vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  supabaseConfigured: true,
}));
vi.mock("@/lib/signature", () => ({
  payloadHash: async () => "correct",
  verifySignature: async () => false,
  fingerprint: (value: string) => value,
}));

const { downloadArchiveZip } = await import("@/lib/client/archive-export");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("refuses an invalid approval signature instead of producing a misleading ZIP", async () => {
  const font = readFileSync(join(process.cwd(), "public/noto-sans-export.woff"));
  const fetchMock = vi.fn(async (url: string) =>
    url.startsWith("/noto")
      ? new Response(font)
      : new Response(
          JSON.stringify({
            signature: {
              envelope: { doc: "a", decision: "sahkan", hash: "correct" },
              publicKey: "key",
              signature: "bad",
              alg: "ES256",
              signedAt: "",
              signerName: "Guru",
              signerTitle: null,
            },
          }),
        ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const plan = {
    id: "a",
    status: "approved",
    payload: emptyPayload(),
    weekNo: 1,
    planDate: "2026-10-05",
    subjectName: "Matematik",
  } as RphDocument;
  await expect(
    downloadArchiveZip([plan], "Sesi", "Guru", "Sekolah", "pdf", () => {}),
  ).rejects.toThrow("Tandatangan tidak sah");
  expect(clicked).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
