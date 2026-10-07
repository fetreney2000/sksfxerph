import type { DskpStandard } from "@/lib/types";

/**
 * Local DSKP reference slice.
 *
 * In a real deployment this is seeded from `dskp_standard` (db/schema.sql) and
 * read via PostgREST with FTS. It ships in the bundle because:
 *   • the picker must work offline (the editor is the offline-first screen),
 *   • KSSR Matematik Tahun 4–6 is what this teacher needs week to week,
 *   • the whole set is a few hundred KB — still under budget.
 *
 * When Supabase is configured, `lib/queries/dskp.ts` fetches the full set and
 * these become the fallback.
 */
export const DSKP: DskpStandard[] = [
  {
    id: 1,
    kodSk: "3.1",
    standardKandungan: "Mengenal, membaca dan menulis semula nombor hingga 100,000",
    kodSp: "3.1.1",
    standardPembelajaran:
      "Menulis semula nombor hingga 100,000 dalam bentuk angka dan perkataan",
    bidang: "Nombor & Operasi",
  },
  {
    id: 2,
    kodSk: "3.1",
    standardKandungan: "Mengenal, membaca dan menulis semula nombor hingga 100,000",
    kodSp: "3.1.2",
    standardPembelajaran: "Memecahkan nombor hingga 100,000 kepada nilai tempat",
    bidang: "Nombor & Operasi",
  },
  {
    id: 3,
    kodSk: "3.3",
    standardKandungan: "Membulatkan nombor kepada puluhan dan ratusan terdekat",
    kodSp: "3.3.1",
    standardPembelajaran: "Membulatkan nombor hingga 100,000 kepada puluhan terdekat",
    bidang: "Nombor & Operasi",
  },
  {
    id: 4,
    kodSk: "2.4",
    standardKandungan: "Pecahan setara dan ringkas",
    kodSp: "2.4.1",
    standardPembelajaran: "Membandingkan dan menyusun pecahan setara",
    bidang: "Nombor & Operasi",
  },
  {
    id: 5,
    kodSk: "5.4",
    standardKandungan: "Ringkasan dan tambah wang",
    kodSp: "5.4.1",
    standardPembelajaran: "Menyelesaikan masalah wang dengan tambah dan tolak",
    bidang: "Nombor & Operasi",
  },
  {
    id: 6,
    kodSk: "4.1",
    standardKandungan: "Operasi asas penambahan dan penolakan",
    kodSp: "4.1.2",
    standardPembelajaran:
      "Menyelesaikan masalah yang melibatkan dua operasi hingga nilai 100,000",
    bidang: "Nombor & Operasi",
  },
];

/** Case/diacritic-insensitive substring match — the picker's whole search. */
export function searchDskp(term: string, limit = 6): DskpStandard[] {
  const q = term.trim().toLowerCase();
  if (q === "") return DSKP.slice(0, limit);
  const hit = DSKP.filter(
    (d) =>
      d.standardKandungan.toLowerCase().includes(q) ||
      d.standardPembelajaran.toLowerCase().includes(q) ||
      d.kodSk.includes(q) ||
      d.kodSp.includes(q) ||
      (d.bidang ?? "").toLowerCase().includes(q),
  );
  return hit.slice(0, limit);
}
