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
 * The shapes below are exactly the fields `review_rph()` reads, so switching
 * to the real query changes the data source, not the component.
 */
export interface QueueItem {
  id: string;
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
  kod_sk: "3.1",
  standard_pembelajaran: "3.1.2 Memecahkan nombor kepada nilai tempat",
  kod_sp: "3.1.2",
  objektif: "Murid dapat memecahkan nombor hingga 100,000 kepada nilai tempat dengan betul.",
  aktiviti: [
    {
      masa: "10 minit",
      aktiviti_guru: "Set induksi kad nilai tempat",
      aktiviti_murid: "Menyusun kad",
    },
    {
      masa: "25 minit",
      aktiviti_guru: "Penerangan & tunjuk cara",
      aktiviti_murid: "Lembaran kerja berkumpulan",
    },
    {
      masa: "10 minit",
      aktiviti_guru: "PdM pemerhatian",
      aktiviti_murid: "Penyelesaian masalah",
    },
    { masa: "5 minit", aktiviti_guru: "Penutup & rumusan", aktiviti_murid: "Refleksi ringkas" },
  ],
  emk: ["Kerjasama", "KBAT · Analisis"],
  kbat: "Murid menilai punca ralat nilai tempat dalam situasi sebenar.",
  refleksi:
    "7 daripada 28 murid keliru dengan nilai “puluhan”; intervensi kumpulan kecil Khamis.",
  intervensi: "Intervensi kumpulan kecil Khamis, 07:00–07:20.",
  bilangan_murid: 28,
});

const suhaila = base({
  standard_kandungan: "Membaca dan memahami petikan prosedur",
  standard_pembelajaran: "2.2.1 Mengenal pasti maklumat penting dalam petikan",
  objektif: "Murid dapat mengenal pasti lima maklumat penting dalam petikan prosedur.",
  aktiviti: [
    { masa: "15 minit", aktiviti_guru: "Bacaan berpandu", aktiviti_murid: "Menanda maklumat" },
    {
      masa: "25 minit",
      aktiviti_guru: "Perbincangan kumpulan",
      aktiviti_murid: "Sintesis maklumat",
    },
  ],
  emk: ["Kerjasama"],
  refleksi: "Kebanyakan murid boleh mengenal pasti maklumat eksplisit.",
  intervensi: "Latihan tambahan untuk maklumat tersirat.",
});

const aizuddin = base({
  standard_kandungan: "Daya dan kesan",
  standard_pembelajaran: "3.1.1 Mengenal pasti daya pada objek",
  objektif: "Murid dapat mengenal pasti daya yang bertindak pada objek harian.",
  aktiviti: [
    {
      masa: "20 minit",
      aktiviti_guru: "Eksperimen ringkas",
      aktiviti_murid: "Merekod pemerhatian",
    },
  ],
  emk: [],
  refleksi: "",
  intervensi: "",
});

export const QUEUE: QueueItem[] = [
  {
    id: "q-1",
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
export const SCHOOL_STATS = {
  activeTeachers: 42,
  totalExpected: 210,
  submitted: 198,
  approved: 186,
  compliancePct: 94,
  avgMinutes: 6.4,
  byPanel: [
    { label: "Prasekolah", pct: 100 },
    { label: "Sekolah Rendah", pct: 95 },
    { label: "Sekolah Menengah", pct: 88 },
  ],
  weeks: [
    { week: 1, pct: 96, rejected: 4 },
    { week: 2, pct: 97, rejected: 3 },
    { week: 3, pct: 95, rejected: 5 },
    { week: 4, pct: 98, rejected: 2 },
    { week: 5, pct: 99, rejected: 1 },
    { week: 6, pct: 94, rejected: 6 },
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
