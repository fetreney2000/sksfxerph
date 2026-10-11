import { strFromU8, unzipSync } from "fflate";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/export/route";
import { emptyPayload } from "@/lib/schemas/rph";
import { LOCAL_ACCOUNTS } from "@/lib/server/auth/local";
import { mintSession, SESSION_COOKIE } from "@/lib/server/auth/token";

/**
 * The exported DOCX, opened.
 *
 * A .docx is a zip, so nothing here trusts that the route returned *a* file —
 * it unzips it and reads the document's own text. That is the only way to
 * notice what this test was written for: the NAMA row came out as a dash and
 * the line above the header as "Guru: undefined", because the name was taken
 * from the request body and no caller ever sent it. Both look like a working
 * export until someone reads the paper.
 *
 * Local mode, deliberately: the export route is pure `docx` — no Supabase —
 * so the whole path can be exercised here, session cookie and all.
 */

/** The Guru Biasa, so the name under test cannot be a hidden default. */
const TEACHER = LOCAL_ACCOUNTS.find((a) => a.username === "guru.biasa")!;

function post(body: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/export", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${mintSession(TEACHER.id)}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

/** The document's text, as Word would read it back. */
async function exportedText(res: Response): Promise<string> {
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("the export has no word/document.xml");
  return strFromU8(xml);
}

const BASE_BODY = {
  payload: emptyPayload(),
  session: "2026/2027",
  planDate: "2026-10-12",
  className: "5 Amanah",
  subjectName: "Matematik",
};

describe("the exported DOCX", () => {
  it("names the teacher who exported it", async () => {
    const res = await POST(post(BASE_BODY));
    expect(res.status).toBe(200);

    const xml = await exportedText(res);
    expect(xml).toContain("NAMA");
    // The NAMA row, and the line above the header that reads "Guru: …".
    expect(xml).toContain(TEACHER.full_name);
    expect(xml).toContain(`Guru: ${TEACHER.full_name}`);
    // Not a dash, and not the string "undefined" that an unfilled template
    // literal printed into the file.
    expect(xml).not.toContain("undefined");
  });

  it("ignores any name sent in the body — a plan is the exporter's own", async () => {
    const res = await POST(post({ ...BASE_BODY, teacherName: "Orang Lain" }));
    expect(res.status).toBe(200);

    const xml = await exportedText(res);
    // The route refuses to export a document that is not the caller's, so the
    // one name that can never appear on their paper is somebody else's.
    expect(xml).not.toContain("Orang Lain");
    expect(xml).toContain(TEACHER.full_name);
  });

  it("says so plainly rather than guessing when the plan is empty", async () => {
    const res = await POST(post({ payload: emptyPayload(), session: "2026/2027" }));
    const xml = await exportedText(res);
    // Class, date and subject were not supplied, so they print the em dash the
    // route has always used for a blank cell — a dash is honest, "undefined"
    // is not.
    expect(xml).toContain("—");
    expect(xml).toContain(TEACHER.full_name);
  });

  it("writes the seal's moment in the school's own time", async () => {
    const res = await POST(
      post({
        ...BASE_BODY,
        signerName: "Ramlan bin Yusof",
        signerTitle: "Penolong Kanan HEM",
        signedAt: "2026-10-12T01:06:00.000Z",
        signatureAlg: "ES256",
      }),
    );
    const xml = await exportedText(res);

    // 01:06 UTC is 09:06 in Kuala Lumpur, and the paper says nine in the
    // morning rather than a timestamp ending in Z.
    expect(xml).toContain("12 Oktober 2026");
    expect(xml).toContain("09:06");
    expect(xml).toContain("Penolong Kanan HEM");
    expect(xml).not.toContain("2026-10-12T");
  });
});
