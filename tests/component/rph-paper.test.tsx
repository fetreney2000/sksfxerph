// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RphPaper } from "@/components/rph/rph-paper";
import { emptyPayload, type RphPayload } from "@/lib/schemas/rph";

/**
 * The school's RPH, rendered.
 *
 * Asserting the *labels* matters more here than in most components: this is
 * what the school prints and sends to its district, and a heading the teacher
 * does not recognise is a bug they will report before any styling problem.
 */
const SESSION = "2026/2027";

const full: RphPayload = {
  ...emptyPayload(),
  standard_kandungan: "Nombor hingga 100,000",
  standard_pembelajaran: "3.1.1 Menulis semula nombor",
  objektif: "Murid dapat menulis semula nombor hingga 100,000.",
  kriteria_kejayaan: "Murid menulis semula nombor dengan betul tanpa bimbingan.",
  bidang: "Nilai tempat",
  tajuk: "Nombor hingga 100,000",
  aktiviti: [
    { nama: "Set induksi" },
    { nama: "Menjawab kuiz", sub: true },
    { nama: "Penerangan" },
    { nama: "Lembaran kerja" },
  ],
  refleksi: "7 daripada 28 murid keliru nilai puluhan.",
};

afterEach(cleanup);

describe("RphPaper — the school's form", () => {
  it("renders every row the printed template has", () => {
    render(<RphPaper payload={full} session={SESSION} />);

    for (const heading of [
      "RANCANGAN PENGAJARAN HARIAN",
      "NAMA",
      "Subjek",
      "Nama Kelas",
      "Hari",
      "Tarikh",
      "Masa Mula",
      "Masa Tamat",
      "Tema / Bidang / Tajuk",
      "Standard Kandungan",
      "Standard Pembelajaran",
      "Objektif",
      "Kriteria Kejayaan",
      "Aktiviti PdPC",
      "Refleksi",
    ]) {
      expect(screen.getAllByText(heading).length, heading).toBeGreaterThan(0);
    }
  });

  it("has no row the form does not have", () => {
    render(<RphPaper payload={full} session={SESSION} />);
    // These were on the KPM circular, not on this school's template — they used
    // to be printed regardless, which meant a document that did not match the
    // paper it had to be filed on.
    for (const gone of ["EMK", "KBAT", "Intervensi", "Bilangan Murid"]) {
      expect(screen.queryByText(new RegExp(gone)), gone).toBeNull();
    }
  });

  it("renders the actual content, not placeholders", () => {
    render(<RphPaper payload={full} session={SESSION} />);
    // "Nombor hingga 100,000" appears in both the Tema cell and Standard
    // Kandungan — asserting it appears more than once is the point: the row
    // that carries it is rendered, not skipped.
    expect(screen.getAllByText(/Nombor hingga 100,000/).length).toBeGreaterThan(1);
    expect(screen.getByText(/Murid dapat menulis semula/)).toBeTruthy();
    expect(screen.getByText("Set induksi")).toBeTruthy();
    expect(screen.getByText(/7 daripada 28 murid/)).toBeTruthy();
    expect(screen.getByText(/tanpa bimbingan/)).toBeTruthy();
  });

  it("prints sub-activities indented behind a hyphen", () => {
    render(<RphPaper payload={full} session={SESSION} />);
    const sub = screen.getByText("Menjawab kuiz");
    expect(sub.className).toMatch(/pl-5/);
    // …and the heading above it is not indented.
    expect(screen.getByText("Set induksi").className).not.toMatch(/pl-5/);
  });

  it("marks unfinished rows instead of hiding them", () => {
    // A blank plan must still show the full document shape with explicit
    // "belum diisi" markers — the reviewer needs to see what is missing.
    render(<RphPaper payload={{ ...emptyPayload() }} session={SESSION} />);
    expect(screen.getAllByText(/belum diisi/).length).toBeGreaterThan(0);
    // Every label cell of the template is still printed, even on an empty plan.
    for (const label of ["Standard Kandungan", "Kriteria Kejayaan", "Refleksi"]) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    }
  });

  it("shows school, session and teacher in the header", () => {
    render(<RphPaper payload={full} session={SESSION} teacherName="Ramlan bin Yusof" />);
    expect(screen.getByText(/SK St. Francis Xavier/)).toBeTruthy();
    expect(screen.getByText(/Ramlan bin Yusof/)).toBeTruthy();
    expect(screen.getByText(new RegExp(SESSION))).toBeTruthy();
  });

  it("derives the day from the date rather than trusting it", () => {
    render(<RphPaper payload={full} session={SESSION} planDate="2026-01-12" />);
    // 12 January 2026 is a Monday.
    expect(screen.getByText(/1\. Isnin/)).toBeTruthy();
  });
});
