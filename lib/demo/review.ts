import { emptyPayload, type RphPayload } from "@/lib/schemas/rph";
import type { RphStatus } from "@/lib/types";

/**
 * Local-mode stand-in for the reviewer's queue.
 *
 * When Supabase is configured this is replaced by
 *   select * from rph_document where school_id = … and status = 'submitted'
 * (index: `rph_document_queue_idx`). Only synthetic because a single-device
 * demo has no colleagues.
 *
 * The shapes below are exactly the fields `sahkan_rph()` reads, so switching
 * to the real query changes the data source, not the component.
 */
export interface QueueItem {
  id: string;
  /**
   * `rph_document.version`.
   *
   * Carried into the client because signing covers it: the server refuses a
   * signature over any version other than the plan's current one, so the
   * reviewer has to know which that is.
   */
  version: number;
  teacherName: string;
  initials: string;
  tone: "blue" | "teal" | "plum";
  className: string;
  subjectName: string;
  planDate: string;
  slotTime: string;
  status: RphStatus;
  ageLabel: string;
  payload: RphPayload;
}

const base = (over: Partial<RphPayload>): RphPayload => ({ ...emptyPayload(), ...over });

const ramlan = base({
  standard_kandungan: "Nombor hingga 100,000 · SK 3.1",
  standard_pembelajaran: "3.1.2 Memecahkan nombor kepada nilai tempat",
  objektif: "Murid dapat memecahkan nombor hingga 100,000 kepada nilai tempat dengan betul.",
  bidang: "Nombor & Operasi",
  tajuk: "Nilai tempat",
  aktiviti: [
    { nama: "Set induksi kad nilai tempat" },
    { nama: "Menyusun kad", sub: true },
    { nama: "Penerangan & tunjuk cara" },
    { nama: "Lembaran kerja berkumpulan", sub: true },
    { nama: "PdM pemerhatian" },
    { nama: "Penyelesaian masalah", sub: true },
    { nama: "Penutup & rumusan" },
  ],
  kriteria_kejayaan:
    "Murid menulis semula nombor hingga 100,000 dengan nilai tempat yang betul tanpa bimbingan.",
  refleksi:
    "7 daripada 28 murid keliru dengan nilai “puluhan”; intervensi kumpulan kecil Khamis.",
});

const suhaila = base({
  standard_kandungan: "Membaca dan memahami petikan prosedur",
  standard_pembelajaran: "2.2.1 Mengenal pasti maklumat penting dalam petikan",
  objektif: "Murid dapat mengenal pasti lima maklumat penting dalam petikan prosedur.",
  bidang: "Membaca & Memahami",
  tajuk: "Petikan prosedur — cara menjaga kesihatan",
  aktiviti: [
    { nama: "Bacaan suara berirama" },
    { nama: "Isi petak maklumat", sub: true },
    { nama: "Perbincangan berkumpulan" },
    { nama: "Rumusan kumpulan", sub: true },
  ],
  kriteria_kejayaan: "Murid melengkapkan petak maklumat dengan lima jawapan yang betul.",
  refleksi: "Tiga murid tercicir menyiapkan petak; ulang set induksi sebelum tajuk seterusnya.",
});

const aizuddin = base({
  standard_kandungan: "Proses mendengar",
  standard_pembelajaran: "Sains & Teknologi · Standard 2.1",
  objektif: "Murid dapat menerangkan proses mendengar dalam situasi harian.",
  bidang: "Sifat Manusia",
  tajuk: "Proses mendengar",
  aktiviti: [{ nama: "Eksperimen ringkas" }, { nama: "Merekod pemerhatian", sub: true }],
  kriteria_kejayaan: "Murid menyenaraikan tiga langkah proses mendengar dengan betul.",
  refleksi:
    "Kelas bising semasa eksperimen; perlu garis panduan kelas sebelum aktiviti seterusnya.",
});

export const QUEUE: QueueItem[] = [
  {
    id: "q-1",
    version: 3,
    teacherName: "Ramlan bin Yusof",
    initials: "RY",
    tone: "blue",
    className: "5 Bidara",
    subjectName: "Matematik",
    planDate: "2026-10-07",
    slotTime: "07:30",
    status: "submitted",
    ageLabel: "Dihantar 12 minit lalu",
    payload: ramlan,
  },
  {
    id: "q-2",
    version: 2,
    teacherName: "Suhaila Hassan",
    initials: "SH",
    tone: "plum",
    className: "4 Kelab",
    subjectName: "Bahasa Melayu",
    planDate: "2026-10-07",
    slotTime: "09:15",
    status: "submitted",
    ageLabel: "Dihantar 40 minit lalu",
    payload: suhaila,
  },
  {
    id: "q-3",
    version: 4,
    teacherName: "Aizuddin Omar",
    initials: "AO",
    tone: "teal",
    className: "5 Amanah",
    subjectName: "Sains",
    planDate: "2026-10-06",
    slotTime: "11:00",
    status: "submitted",
    ageLabel: "Dihantar 2 jam lalu",
    payload: aizuddin,
  },
];

/** Aggregates for the school dashboard — local stand-in for `school_week_stats`. */
/**
 * Local mode's figures.
 *
 * Local mode has no backend, so these stand in — and they are fine there
 * because local mode *is* a demo. What was wrong before was that synced mode
 * replaced some fields and left the rest: `byPanel`, `weeks` and `avgMinutes`
 * stayed these constants and were then presented as the school's own. Every
 * field here is now either replaced in synced mode or absent from the shape.
 */
export const SCHOOL_STATS = {
  activeTeachers: 42,
  submitted: 198,
  approved: 186,
  returned: 12,
  // 42 teachers × 5 RPH — the same rule the real figures are measured
  // against, so the demo numbers at least add up the way the school's do.
  compliancePct: 88.6,
  avgMinutes: 6.4,
  weeks: [
    {
      week: 1,
      teachers: 42,
      expected: 210,
      submitted: 190,
      approved: 188,
      returned: 4,
      compliance: 89.5,
      avgMinutes: 7.2,
    },
    {
      week: 2,
      teachers: 42,
      expected: 210,
      submitted: 195,
      approved: 193,
      returned: 3,
      compliance: 91.9,
      avgMinutes: 7.0,
    },
    {
      week: 3,
      teachers: 42,
      expected: 210,
      submitted: 188,
      approved: 186,
      returned: 5,
      compliance: 88.6,
      avgMinutes: 6.8,
    },
    {
      week: 4,
      teachers: 42,
      expected: 210,
      submitted: 197,
      approved: 195,
      returned: 2,
      compliance: 92.9,
      avgMinutes: 6.6,
    },
    {
      week: 5,
      teachers: 42,
      expected: 210,
      submitted: 199,
      approved: 198,
      returned: 1,
      compliance: 94.3,
      avgMinutes: 6.5,
    },
    {
      week: 6,
      teachers: 42,
      expected: 210,
      submitted: 198,
      approved: 186,
      returned: 6,
      compliance: 88.6,
      avgMinutes: 6.4,
    },
  ],
};

export const TEACHER_ROWS = [
  {
    name: "Nurul Aisyah",
    initials: "NA",
    tone: "blue" as const,
    role: "Guru Penyelaras",
    panel: "Matematik · 3 kelas",
    week: "Lengkap" as const,
    compliance: 98,
    last: "Hari ini 08:42",
  },
  {
    name: "Ramlan Yusof",
    initials: "RY",
    tone: "blue" as const,
    role: "",
    panel: "Matematik · 4 kelas",
    week: "Menunggu" as const,
    compliance: 94,
    last: "Hari ini 07:58",
  },
  {
    name: "Suhaila Hassan",
    initials: "SH",
    tone: "plum" as const,
    role: "",
    panel: "Bahasa Melayu · 5 kelas",
    week: "Lewat" as const,
    compliance: 76,
    last: "3 Okt 16:20",
  },
  {
    name: "Aizuddin Omar",
    initials: "AO",
    tone: "teal" as const,
    role: "",
    panel: "Sains · 4 kelas",
    week: "Lengkap" as const,
    compliance: 91,
    last: "Hari ini 07:40",
  },
];
