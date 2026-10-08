/**
 * Malay-first copy.
 *
 * One locale, no i18n framework (erph-frontend-stack.md §9 — an i18n library is
 * dead weight when there is exactly one language). Kept as a typed object so a
 * missing key is a compile error, not a blank label in front of a teacher.
 *
 * Vocabulary matches KPM's own wording from Surat Siaran KPM Bil. 2/2025 and
 * the Garis Panduan e-RPH.
 */
export const ms = {
  appName: "eRPH",
  appTagline: "Rancangan Pengajaran Harian",

  nav: {
    minggu: "Minggu Ini",
    editor: "Penyunting RPH",
    templat: "Perpustakaan Templat",
    arkib: "Sejarah & Arkib",
    semakan: "Semakan RPH",
    sekolah: "Paparan Sekolah",
    guru: "Guru",
    pentadbiran: "Pentadbiran",
    rujukan: "Rujukan rasmi",
  },

  dashboard: {
    greeting: "Selamat pagi",
    deadline: "Tarikh akhir",
    submitted: "Dihantar",
    waiting: "Menunggu semakan",
    needsAction: "Perlu tindakan",
    onTime: "Ketepatan masa",
    weeklySchedule: "Jadual PdP minggu ini",
    newRph: "RPH baharu",
    reuseLast: "Guna semula minggu lepas",
    shortcuts: "Pintasan",
    activity: "Aktiviti semakan terkini",
    noPrint: "Tiada keperluan mencetak — dokumen hanya perlu diemaskan apabila diminta.",
  },

  status: {
    draft: "Draf",
    submitted: "Menunggu",
    approved: "Lengkap (1)",
    returned: "Dikembalikan",
    scheduled: "Dijadualkan",
    complete: "Lengkap",
    incomplete: "Tidak lengkap",
    notSubmitted: "belum hantar",
    offline: "Luar talian",
    queued: (n: number) => `${n} belum disegerakkan`,
    synced: "Disegerakkan",
    saving: "Disimpan",
    online: "Dalam talian",
  },

  editor: {
    step1: "Profil",
    step1sub: "Kelas · tarikh · masa",
    step2: "DSKP",
    step2sub: "Standard Kandungan & Pembelajaran",
    step3: "PdPc",
    step3sub: "Objektif · aktiviti · EMK",
    step4: "Refleksi",
    step4sub: "Refleksi · intervensi",
    subject: "Mata pelajaran",
    class: "Kelas",
    date: "Tarikh",
    time: "Masa",
    students: "Bilangan murid",
    standardKandungan: "Standard Kandungan",
    standardPembelajaran: "Standard Pembelajaran",
    objective: "Objektif pembelajaran",
    activities: "Aktiviti Pengajaran & Pembelajaran",
    emk: "Elemen Merentas Kurikulum & nilai",
    reflection: "Refleksi",
    intervention: "Intervensi",
    completeness: "Keluargaan dokumen",
    preview: "Pratonton langsung",
    submit: "Hantar untuk semakan",
    exportPdf: "Eksport PDF",
    required: "diperlukan",
    totalTime: "Jumlah masa aktif",
    ready: "Sedia dihantar",
    notReady: "Belum lengkap",
    sectionNav: "Bahagian dokumen",
    sectionDone: "Lengkap",
    tabForm: "Kandungan",
    tabPreview: "Pratonton",
    showPreview: "Tunjuk pratonton",
    hidePreview: "Sembunyi pratonton",
    backToForm: "Kembali ke kandungan",
    attentionLabel: "Perkara perlu diberi perhatian",
    incompleteHeading: (n: number) => `${n} perkara perlu diberi perhatian`,
    draftWarning:
      "Dokumen boleh dihantar sebagai draf tidak lengkap, tetapi GPK mungkin mengembalikannya (gred 0).",
    missing: {
      sk: "Standard Kandungan belum dipilih",
      sp: "Standard Pembelajaran belum dipilih",
      objektif: "Objektif pembelajaran belum diisi",
      noAktiviti: "Tiada aktiviti PdPc lagi",
      aktivitiGuru: "Aktiviti 1 — aktiviti guru belum diisi",
      aktivitiMurid: "Aktiviti 1 — aktiviti murid belum diisi",
      refleksi: "Refleksi belum diisi",
      intervensi: "Intervensi atau elemen EMK belum dipilih",
    },
  },

  review: {
    queue: "Baris gilir",
    approve: "Lulus · Lengkap (1)",
    return: "Kembalikan · Tidak lengkap (0)",
    saveAndContinue: "Simpan & teruskan",
    comment: "Komen sulit",
    commentHint: "hanya guru melihat",
    autoCheck: "Semakan automatik",
    pending: "Belum disemak",
    all: "Semua",
    keyboardHint: "navigasi",
    grade1: "lulus",
    grade0: "kembalikan",
  },

  a11y: {
    skipToContent: "Langkau ke kandungan",
    mainNavigation: "Navigasi utama",
    darkMode: "Mod gelap",
    lightMode: "Mod cerah",
    notifications: "Pemberitahuan",
    close: "Tutup",
  },
} as const;

export type Dictionary = typeof ms;
