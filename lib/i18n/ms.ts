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
  appTagline: "Rancangan Pengajaran Harian",

  /** How each `erph.member_role` is written to the person using the account. */
  roles: {
    guru_biasa: "Guru Biasa",
    gpk: "Guru Penolong Kanan",
    guru_besar: "Guru Besar",
    pentadbir: "Administrator",
    system: "Sistem",
  },

  /**
   * How each `erph.jawatan` is written on paper — the JAWATAN row of the
   * weekly cover sheet and the accounts picker. Keyed by the enum so the
   * printed office and the selected one can never drift apart.
   */
  jawatan: {
    guru_biasa: "Guru Biasa",
    pk_pentadbiran: "Penolong Kanan Pentadbiran",
    pk_hem: "Penolong Kanan HEM",
    pk_kokum: "Penolong Kanan Kokum",
    guru_besar: "Guru Besar",
  },

  nav: {
    minggu: "Minggu Ini",
    editor: "Penyunting RPH",
    templat: "Perpustakaan Templat",
    arkib: "Sejarah & Arkib",
    semakan: "Semakan RPH",
    sekolah: "Paparan Sekolah",
    guru: "Guru",
    pentadbiran: "Pentadbiran",
    urus: "Urus eRPH",
    utama: "Utama",
  },

  dashboard: {
    /**
     * Which greeting the hour calls for — paired with `greetingPart()` in
     * lib/date.ts, which reads the school's clock rather than the browser's.
     * A single fixed greeting said "Selamat pagi" to a teacher opening the app
     * at nine at night.
     */
    greeting: {
      pagi: "Selamat pagi",
      tengahHari: "Selamat tengah hari",
      petang: "Selamat petang",
      malam: "Selamat malam",
    },
    deadline: "Tarikh akhir",
    submitted: "Dihantar",
    waiting: "Menunggu semakan",
    needsAction: "Perlu tindakan",
    onTime: "Ketepatan masa",
    weeklySchedule: "Jadual PdP minggu ini",
    newRph: "RPH baharu",
    printWeek: "Cetak minggu",
    reuseLast: "Guna semula minggu lepas",
    shortcuts: "Pintasan",
    activity: "Aktiviti semakan terkini",
    noPrint: "Tiada keperluan mencetak — dokumen hanya perlu diemaskan apabila diminta.",
  },

  status: {
    draft: "Draf",
    submitted: "Menunggu GPK",
    forwarded: "Menunggu Guru Besar",
    approved: "Lengkap (1)",
    returned: "Dikembalikan",
    scheduled: "Dijadualkan",
    complete: "Lengkap",
    incomplete: "Tidak lengkap",
    notSubmitted: "belum hantar",
    offline: "Luar talian",
    queued: (n: number) => `${n} belum diselesaikan`,
    synced: "Disegerakkan",
    saving: "Disimpan",
    online: "Dalam talian",
  },

  editor: {
    step1: "Profil",
    step1sub: "Kelas · tarikh · masa · tema",
    step2: "DSKP",
    step2sub: "Standard & objektif",
    step3: "PdPc",
    step3sub: "Aktiviti · Kriteria Kejayaan",
    step4: "Refleksi",
    step4sub: "Perkara susulan",
    subject: "Mata pelajaran",
    class: "Kelas",
    /**
     * The week the plan files under. A choice, not a stamp: a week missed to
     * illness still had lessons, and the RPH for them is still owed.
     */
    week: "Minggu",
    weekHint: "Minggu yang telah berlalu boleh diisi semula.",
    date: "Tarikh",
    time: "Masa Mula",
    timeEnd: "Masa Tamat",
    students: "Bilangan murid",
    standardKandungan: "Standard Kandungan",
    standardPembelajaran: "Standard Pembelajaran",
    objective: "Objektif pembelajaran",
    // The school's form calls the section "Aktiviti PdPC" and its success
    // criterion "Kriteria Kejayaan" — names a teacher recognises from the
    // paper they have been filling in for years.
    activities: "Aktiviti PdPC",
    successCriteria: "Kriteria Kejayaan",
    theme: "Tema / Bidang / Tajuk",
    reflection: "Refleksi",
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
      sk: "Standard Kandungan belum diisi",
      sp: "Standard Pembelajaran belum diisi",
      objektif: "Objektif pembelajaran belum diisi",
      noAktiviti: "Tiada aktiviti PdPC lagi",
      kriteria: "Kriteria Kejayaan belum diisi",
      refleksi: "Refleksi belum diisi",
    },
  },

  review: {
    queue: "Baris gilir",
    // One stage: a GPK or the Guru Besar either approves — signed — or returns.
    // `forward`, `forwardHint`, `gpkNote` and `gbNote` are gone with the hop
    // they described: there is nobody left to send it *to*.
    approve: "Sahkan · Lengkap (1)",
    approveHint: "sahkan",
    return: "Kembalikan · Tidak lengkap (0)",
    saveAndContinue: "Simpan & teruskan",
    comment: "Komen sulit",
    commentHint: "hanya guru melihat",
    autoCheck: "Semakan automatik",
    pending: "Belum disemak",
    all: "Semua",
    keyboardHint: "navigasi",
    grade0: "kembalikan",
    signedNote:
      "Mengesahkan menandatangani rancangan ini dengan kunci penyemak sendiri — nama, versi dan waktu keputusan tercatat bersamanya, dan guru boleh mengesahkannya sendiri.",
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
