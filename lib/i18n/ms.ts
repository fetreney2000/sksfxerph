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
    pentadbir: "Pentadbir",
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
    arkib: "Sejarah dan Arkib",
    semakan: "Semakan RPH",
    sekolah: "Paparan Sekolah",
    guru: "Guru",
    penyeliaan: "Penyeliaan",
    pentadbiran: "Pentadbiran",
    sumber: "Sumber",
    urus: "Urus eRPH",
    utama: "Papan Pemuka",
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
    approved: "Disahkan",
    waiting: "Menunggu semakan",
    needsAction: "Perlu tindakan",
    onTime: "Ketepatan masa",
    weeklySchedule: "Jadual PdP minggu ini",
    newRph: "RPH baharu",
    printWeek: "Cetak minggu",
    reuseLast: "Guna semula minggu lepas",
    shortcuts: "Pintasan",
    activity: "Aktiviti semakan terkini",
    noPrint: "Tiada keperluan mencetak — dokumen hanya perlu disediakan apabila diminta.",
  },

  status: {
    draft: "Draf",
    submitted: "Menunggu GPK",
    forwarded: "Menunggu Guru Besar",
    approved: "Disahkan",
    /**
     * The same state as it is printed.
     *
     * `(1)` is KPM's grade, and it belongs on the reviewer's screen where the
     * 0/1 *is* the decision being made. The STATUS row of a printed week is
     * read by someone filing the stack, not grading it, and the paper form
     * says "Lengkap".
     */
    approvedPaper: "Lengkap",
    returned: "Dikembalikan",
    scheduled: "Dijadualkan",
    complete: "Lengkap",
    incomplete: "Tidak lengkap",
    offline: "Luar talian",
    queued: (n: number) => `${n} belum diselesaikan`,
    synced: "Disegerakkan",
    saving: "Disimpan",
    online: "Dalam talian",
  },

  editor: {
    step1: "Profil",
    step1sub: "Kelas · tarikh · masa · tema",
    /** A template has no class, date or lesson time, so neither does this line. */
    step1subTemplate: "Subjek · tema · bidang · tajuk",
    step2: "DSKP",
    step2sub: "Standard dan objektif",
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
    completeness: "Kelengkapan dokumen",
    preview: "Pratonton langsung",
    submit: "Hantar untuk semakan",
    submitIncomplete: "Hantar juga (tidak lengkap)",
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
      "RPH ini akan dihantar kepada GPK sekarang walaupun belum lengkap. GPK boleh mengembalikannya sebagai Tidak lengkap (0).",
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
    queue: "Giliran semakan",
    // One stage: a GPK or the Guru Besar either approves — signed — or returns.
    // `forward`, `forwardHint`, `gpkNote` and `gbNote` are gone with the hop
    // they described: there is nobody left to send it *to*.
    approve: "Sahkan · Lengkap (1)",
    approveShort: "Sahkan",
    approveHint: "sahkan",
    return: "Kembalikan · Tidak lengkap (0)",
    returnShort: "Kembalikan",
    tapHint: "Ketik RPH untuk membuka paparan penuh.",
    comment: "Maklum balas sulit",
    commentHint: "wajib sebelum mengembalikan — hanya guru boleh melihat",
    returnReasonRequired:
      "Tulis sebab atau pilih daripada senarai semak sebelum mengembalikan.",
    approvedThisSession: "Disahkan sesi ini",
    returnedThisSession: "Dikembalikan sesi ini",
    autoCheck: "Semakan automatik",
    pending: "Belum disemak",
    all: "Semua",
    keyboardHint: "navigasi",
    grade0: "kembalikan",
    signedNote:
      "Mengesahkan bermakna menandatangani rancangan ini dengan kunci penyemak sendiri — nama, versi dan masa keputusan tercatat bersamanya, dan guru boleh mengesahkannya sendiri.",
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
