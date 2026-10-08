// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RphPaper } from "@/components/rph/rph-paper";
import { emptyPayload, type RphPayload } from "@/lib/schemas/rph";

// RTL only auto-cleans when Vitest globals are on (they're deliberately off
// here), so every test would otherwise accumulate the previous render.
afterEach(cleanup);

/**
 * Component tests (erph-frontend-stack.md §10.2).
 *
 * `RphPaper` is the one component whose output must match a *statutory*
 * document (Peraturan 8, Akta Pendidikan 1996 [Akta 550]) — what renders here
 * is what prints and what the reviewer grades, so a regression here is a
 * compliance regression, not a cosmetic one.
 */
const SESSION = "2026/2027";

const full: RphPayload = {
  ...emptyPayload(),
  standard_kandungan: "Nombor hingga 100,000",
  standard_pembelajaran: "3.1.1 Menulis semula nombor",
  objektif: "Murid dapat menulis semula nombor hingga 100,000.",
  aktiviti: [
    { masa: "10 minit", aktiviti_guru: "Set induksi", aktiviti_murid: "Menjawab kuiz" },
    { masa: "20 minit", aktiviti_guru: "Penerangan", aktiviti_murid: "Lembaran kerja" },
  ],
  emk: ["Kerjasama", "Kreativiti"],
  kbat: "Murid menilai situasi sebenar.",
  refleksi: "7 daripada 28 murid keliru nilai puluhan.",
  intervensi: "Intervensi kumpulan kecil Khamis.",
  bilangan_murid: 28,
  fasa_tema: "Nombor & Operasi",
};

describe("RphPaper — KPM document render", () => {
  it("renders every required section heading", () => {
    render(<RphPaper payload={full} session={SESSION} />);
    for (const heading of [
      "Rancangan Pengajaran Harian",
      "Objektif Pembelajaran",
      "Aktiviti Pengajaran & Pembelajaran",
      "EMK / Nilai",
      "Refleksi & Intervensi",
      "Tandatangan Guru",
      "Semakan Pentadbir",
    ]) {
      expect(screen.getAllByText(heading).length, heading).toBeGreaterThan(0);
    }
  });

  it("renders the actual content, not placeholders", () => {
    render(<RphPaper payload={full} session={SESSION} />);
    expect(screen.getByText(/Nombor hingga 100,000/)).toBeTruthy();
    expect(screen.getByText(/Murid dapat menulis semula/)).toBeTruthy();
    expect(screen.getByText("Set induksi")).toBeTruthy();
    expect(screen.getByText(/7 daripada 28 murid/)).toBeTruthy();
    expect(screen.getByText(/Kerjasama/)).toBeTruthy();
  });

  it("renders one activity row per plan entry", () => {
    render(<RphPaper payload={full} session={SESSION} />);
    expect(screen.getByText("Penerangan")).toBeTruthy();
    expect(screen.queryAllByText(/belum diisi/)).toHaveLength(0);
  });

  it("marks unfinished sections instead of hiding them", () => {
    // A blank plan must still show the full document shape with explicit
    // "belum diisi" markers — the reviewer needs to see what is missing.
    render(
      <RphPaper
        payload={{ ...emptyPayload(), standard_kandungan: "Pecahan setara" }}
        session={SESSION}
      />,
    );
    expect(screen.getAllByText(/belum diisi/).length).toBeGreaterThan(0);
    expect(screen.getByText(/— belum dipilih —/)).toBeTruthy();
    expect(screen.getByText(/Pecahan setara/)).toBeTruthy();
  });

  it("shows session, school and teacher in the header", () => {
    render(<RphPaper payload={full} session={SESSION} teacherName="Ramlan bin Yusof" />);
    expect(screen.getByText(/SK St. Francis Xavier/)).toBeTruthy();
    expect(screen.getByText(/Ramlan bin Yusof/)).toBeTruthy();
    expect(screen.getByText(new RegExp(SESSION))).toBeTruthy();
  });
});
