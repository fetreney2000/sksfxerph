// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { RphCover } from "@/components/rph/rph-cover";
import { ms } from "@/lib/i18n/ms";

/**
 * The cover sheet is the page a district reads first, and the only one that
 * carries the week's approval. Its labels are the ones printed on the school's
 * form, so — as with RphPaper — asserting them is the point: a heading the
 * reviewer does not recognise is a document that cannot be filed.
 */
const SESSION = "2026/2027";

const SEAL: SignaturePayload = {
  envelope: { v: 1, alg: "ES256" },
  signature: "c2lnbmF0dXJl",
  publicKey: "cHVibGlja2V5MTIzNDU2Nzg5MDEyMzQ1",
  alg: "ES256",
  signedAt: "2026-01-21T02:00:00.000Z",
  signerName: "Bob Edrem bin Pemin",
  signerTitle: "PK KO",
};

const BASE = {
  weekNo: 1,
  session: SESSION,
  teacherName: "Kartini Serah",
  status: "submitted" as const,
};

afterEach(cleanup);

describe("RphCover — the weekly summary", () => {
  it("renders every row the printed form has", () => {
    render(<RphCover {...BASE} />);
    for (const label of [
      "SEMAKAN RANCANGAN HARIAN GURU",
      "MINGGU",
      "NAMA GURU",
      "TARIKH PENGHANTARAN",
      "STATUS",
      "TANDATANGAN PENTADBIR",
      "NAMA PENTADBIR",
      "JAWATAN",
      "CATATAN PENTADBIR",
      "TARIKH PENGESAHAN",
    ]) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    }
  });

  it("labels the week the way the form does", () => {
    render(<RphCover {...BASE} />);
    expect(screen.getByText("M1 / 2026")).toBeTruthy();
  });

  it("prints the submission down to the minute", () => {
    render(<RphCover {...BASE} submittedAt={new Date("2026-01-19T01:06:00.000Z").getTime()} />);
    // The form's stamp is local wall-clock, not UTC — asserting the shape and
    // the date keeps this true whichever timezone the test runs in.
    expect(screen.getByText(/^\d{2}-01-2026 \| \d{2}:\d{2} (AM|PM)$/)).toBeTruthy();
  });

  it("leaves the approval fields blank until something is sealed", () => {
    render(<RphCover {...BASE} />);
    for (const field of ["Bob Edrem bin Pemin", "PK KO"]) {
      expect(screen.queryByText(field), field).toBeNull();
    }
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("names the signer, their jawatan and the date they confirmed it", () => {
    render(<RphCover {...BASE} signature={SEAL} signatureState="valid" status="approved" />);
    // Twice: once inside the seal, once in NAMA PENTADBIR. The form has both —
    // the seal is what makes it trustworthy, the row is what a reader scans.
    expect(screen.getAllByText("Bob Edrem bin Pemin").length).toBe(2);
    expect(screen.getByText("PK KO")).toBeTruthy();
    // signedAt is 21 January 2026 in UTC; the printed date is local wall-clock,
    // so assert the day rather than the whole stamp.
    expect(screen.getByText(/-01-2026$/)).toBeTruthy();
  });

  it("keeps a missing jawatan visible as missing, not blank", () => {
    // A name with no office under it is a name anyone could have typed. If the
    // school never recorded one, the sheet should say so rather than print an
    // empty line that reads as though it were simply left unfilled.
    render(
      <RphCover {...BASE} signature={{ ...SEAL, signerTitle: null }} signatureState="valid" />,
    );
    const jawatan = screen.getByText("JAWATAN").closest("tr");
    expect(jawatan?.textContent).toBe("JAWATAN—");
  });

  it("prints CATATAN PENTADBIR as a box to write in, not a dash", () => {
    const { container } = render(<RphCover {...BASE} />);
    const row = screen.getByText("CATATAN PENTADBIR").closest("tr");
    expect(row?.textContent).toBe("CATATAN PENTADBIR");
    expect(container.textContent).not.toMatch(/CATATAN PENTADBIR—/);
  });

  it("shows the reviewer's comment when there is one", () => {
    render(<RphCover {...BASE} comment="Semak semula aktiviti minggu depan." />);
    expect(screen.getByText("Semak semula aktiviti minggu depan.")).toBeTruthy();
  });

  it("shows the status under the same name the app uses", () => {
    // The cover must not invent a word. A teacher who submits and then reads
    // "Lengkap (1)" on the printed sheet should recognise it as the badge they
    // just saw go green.
    render(<RphCover {...BASE} status="approved" />);
    expect(screen.getByText(ms.status.approved)).toBeTruthy();
  });
});
