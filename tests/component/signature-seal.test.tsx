// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { SignatureSeal } from "@/components/rph/signature-seal";

// This project registers no Vitest setup file, so Testing Library's automatic
// cleanup never runs and every render appends another container to the
// document. Without this, a `queryByText` in one test finds what the previous
// test rendered — which is exactly how the first draft of these tests lied.
afterEach(cleanup);

/**
 * The seal is a claim about a document, so the state that matters is not the
 * valid one — it is the invalid one. A signature that fails to verify, or one
 * whose envelope no longer matches the plan beside it, is the single case where
 * rendering quietly would convert a tampered document into a trusted one.
 */
const SEAL: SignaturePayload = {
  envelope: { v: 1, alg: "ES256" },
  signature: "c2lnbmF0dXJl",
  publicKey: "cHVibGlja2V5MTIzNDU2Nzg5MDEyMzQ1",
  alg: "ES256",
  signedAt: "2026-10-10T08:14:02.000Z",
  signerName: "Ramlan bin Yusof",
  // The office the cover sheet prints from erph.user.jawatan — "PK KO" was a
  // value nothing in the system could ever have supplied.
  signerTitle: "Penolong Kanan HEM",
};

describe("signature seal", () => {
  it("renders nothing at all when a plan carries no seal", () => {
    const { container } = render(<SignatureSeal signature={null} state="none" />);
    // Not an empty box, not a placeholder — an unapproved plan must print the
    // blank reviewer line it always has.
    expect(container.firstChild).toBeNull();
  });

  it("draws the line to sign on on paper, and nothing at all on screen", () => {
    const paper = render(<SignatureSeal signature={null} state="none" variant="print" />);
    // The form has a signature area whether or not anyone has approved it, so
    // the printed block keeps its rule and two blank lines.
    expect(paper.container.querySelector("[class*='border-t']")).toBeTruthy();

    const onScreen = render(<SignatureSeal signature={null} state="none" />);
    // On screen a blank block would read as an approval that has not happened.
    expect(onScreen.container.firstChild).toBeNull();
  });

  it("names the reviewer and when they sealed it", () => {
    render(<SignatureSeal signature={SEAL} state="valid" />);

    expect(screen.getByText("Disahkan secara digital")).toBeTruthy();
    expect(screen.getByText("Ramlan bin Yusof")).toBeTruthy();
    expect(screen.getByText(/ES256/)).toBeTruthy();
  });

  it("puts the reviewer's office under their name, or nothing if unset", () => {
    const { unmount } = render(<SignatureSeal signature={SEAL} state="valid" />);
    expect(screen.getByText("Penolong Kanan HEM")).toBeTruthy();
    unmount();

    // No office was ever set, so the line is absent rather than a dash — the
    // name alone is still true, and a dash would look like a rendering fault.
    render(<SignatureSeal signature={{ ...SEAL, signerTitle: null }} state="valid" />);
    expect(screen.queryByText("Penolong Kanan HEM")).toBeNull();
    expect(screen.getByText("Ramlan bin Yusof")).toBeTruthy();
  });

  it("says it is still checking rather than claiming validity", () => {
    render(<SignatureSeal signature={SEAL} state="pending" />);

    expect(screen.getByText(/Memeriksa tandatangan/)).toBeTruthy();
    expect(screen.queryByText("Disahkan secara digital")).toBeNull();
  });

  it("shouts when the signature does not verify", () => {
    render(<SignatureSeal signature={SEAL} state="invalid" />);

    // `role="alert"` so a screen reader interrupts, and wording that says what
    // to do — not a grey line a reader could take for a footnote.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Tandatangan tidak sah/);
    expect(alert.textContent).toMatch(/Jangan keluarkan dokumen/);
  });

  it("does not attribute an unverifiable signature to anyone", () => {
    render(<SignatureSeal signature={SEAL} state="invalid" />);

    // Printing a name beside a signature that does not verify would attach a
    // person to a claim that could not be confirmed — and the office under it
    // would attach the same person's standing.
    expect(screen.queryByText("Ramlan bin Yusof")).toBeNull();
    expect(screen.queryByText("Penolong Kanan HEM")).toBeNull();
    expect(screen.queryByText(/ES256/)).toBeNull();
  });

  it("is a signature block on paper, not a status card", () => {
    const { container } = render(
      <SignatureSeal signature={SEAL} state="valid" variant="print" />,
    );

    // The paper form has a signature block — left-aligned under its label, like
    // the rest of the sheet, with a rule for a signature to rest on. What it
    // does not have is the app's green panel: a card printed on every approved
    // sheet is a screenshot, and screenshots are not filed.
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("items-start");
    expect(el.className).not.toContain("bg-success-soft");
    expect(container.querySelector("[class*='border-t']")).toBeTruthy();

    // The name is the largest thing in the block, and the proof is a
    // fingerprint — a fragment from each end — not a wall of base64.
    expect(screen.getByText("Ramlan bin Yusof")).toBeTruthy();
    expect(screen.getByText(/ES256 · kunci/)).toBeTruthy();
  });
});
