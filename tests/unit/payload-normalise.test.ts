import { describe, expect, it } from "vitest";
import { emptyPayload, normalisePayload, temaLengkap } from "@/lib/schemas/rph";

/**
 * Documents written before the school's template reshape are still in the
 * database, and they carry the old shape.
 *
 * The bug this guards against: opening one from the archive crashed the
 * editor on `payload.kriteria_kejayaan.trim()`, because a key that only
 * exists from payload v2 onwards was read as though it always had. zod's
 * defaults never applied — they only apply if something *parses*, and a
 * document read straight out of Dexie or a JSONB column never does.
 */
const V1 = {
  payload_version: 1,
  fasa_tema: "Nombor & Operasi",
  kod_sk: "3.1",
  standard_kandungan: "Nombor hingga 100,000",
  kod_sp: "3.1.1",
  standard_pembelajaran: "3.1.1 Menulis semula nombor",
  objektif: "Murid dapat menulis semula nombor hingga 100,000.",
  aktiviti: [
    {
      masa: "10 minit",
      aktiviti_guru: "Set induksi kad nilai tempat",
      aktiviti_murid: "Menyusun kad",
    },
    {
      masa: "20 minit",
      aktiviti_guru: "Penerangan & tunjuk cara",
      aktiviti_murid: "Lembaran kerja",
    },
  ],
  emk: ["Kerjasama"],
  kbat: "Murid menilai situasi sebenar.",
  refleksi: "7 daripada 28 murid keliru nilai puluhan.",
  intervensi: "Intervensi kumpulan kecil Khamis.",
};

describe("normalisePayload — reading a document written before the reshape", () => {
  it("fills every field the current shape expects", () => {
    const p = normalisePayload(V1);
    // The crash: undefined has no .trim().
    expect(p.kriteria_kejayaan).toBe("");
    expect(p.tajuk).toBe("");
    expect(p.standard_kandungan).toBe("Nombor hingga 100,000");
    expect(p.refleksi).toContain("7 daripada 28");
  });

  it("keeps the old plan's activities rather than emptying the page", () => {
    // v1 put the content in `aktiviti_guru`. Dropping it would turn a filled
    // page into a blank one the next time it printed — worse than the crash,
    // because it would look like the teacher had never written anything.
    const p = normalisePayload(V1);
    expect(p.aktiviti.map((a) => a.nama)).toEqual([
      "Set induksi kad nilai tempat",
      "Penerangan & tunjuk cara",
    ]);
    expect(p.aktiviti.every((a) => a.sub === false)).toBe(true);
  });

  it("passes the things that read a payload without guarding", () => {
    // Every one of these threw on the v1 payload before normalisation.
    const p = normalisePayload(V1);
    expect(() => p.kriteria_kejayaan.trim()).not.toThrow();
    expect(() => temaLengkap(p)).not.toThrow();
    expect(temaLengkap(p)).toBe("Nombor & Operasi");
  });

  it("leaves a current document alone", () => {
    const now = {
      ...emptyPayload(),
      tajuk: "Nilai tempat",
      kriteria_kejayaan: "Murid menulis semula nombor.",
      aktiviti: [
        { nama: "Set induksi", sub: false },
        { nama: "Catur", sub: true },
      ],
    };
    expect(normalisePayload(now)).toEqual(now);
  });

  it("keeps a half-typed activity instead of failing the whole document", () => {
    // zod requires a non-empty name, which is right for saving and wrong for
    // reading: a blank row is work in progress, and rejecting the document to
    // complain about it would trade a crash for data loss.
    const p = normalisePayload({
      ...emptyPayload(),
      aktiviti: [{ nama: "" }, { nama: "Catur" }],
    });
    expect(p.aktiviti).toEqual([{ nama: "Catur", sub: false }]);
  });

  it("survives garbage, because storage is not a schema", () => {
    for (const bad of [null, undefined, "not an object", 42, { aktiviti: "nope" }, {}]) {
      const p = normalisePayload(bad);
      expect(p.standard_kandungan).toBe("");
      expect(p.aktiviti).toEqual([]);
    }
  });

  it("does not throw on anything a v1 row can hold", () => {
    expect(() => normalisePayload(V1)).not.toThrow();
  });
});
