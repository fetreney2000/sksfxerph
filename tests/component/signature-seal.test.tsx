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
};

describe("signature seal", () => {
  it("renders nothing at all when a plan carries no seal", () => {
    const { container } = render(<SignatureSeal signature={null} state="none" />);
    // Not an empty box, not a placeholder — an unapproved plan must print the
    // blank reviewer line it always has.
    expect(container.firstChild).toBeNull();
  });

  it("names the reviewer and when they sealed it", () => {
    render(<SignatureSeal signature={SEAL} state="valid" />);

    expect(screen.getByText("Disahkan secara digital")).toBeTruthy();
    expect(screen.getByText("Ramlan bin Yusof")).toBeTruthy();
    expect(screen.getByText(/ES256/)).toBeTruthy();
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
    // person to a claim that could not be confirmed.
    expect(screen.queryByText("Ramlan bin Yusof")).toBeNull();
    expect(screen.queryByText(/ES256/)).toBeNull();
  });

  it("fits the A4 document when asked for the print variant", () => {
    const { container } = render(
      <SignatureSeal signature={SEAL} state="valid" variant="print" />,
    );

    // The paper is styled at KPM proportions, so the print seal drops the
    // screen card's scale and border colour rather than shrinking it with
    // CSS later.
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("items-center");
    expect(el.className).toContain("border-[#067647]");
    expect(screen.getByText("Ramlan bin Yusof")).toBeTruthy();
  });
});
