# Front-End Research: Designing an Effective eRPH (Electronic Daily Lesson Plan) System

_Perspective: system developer / product engineer. Companion to `research-erph-malaysian-teachers.md`. Research date: 4 October 2026._

---

## 1. Scope & method

"Front-end" here means everything the teacher/administrator actually touches: information architecture, screens, UI components, interaction patterns, responsiveness, offline behaviour, and the client-side architecture needed to deliver them. Research inputs:

- KPM's own spec of the current official front-end: **Surat Siaran KPM Bil. 2/2025 + Garis Panduan Penyediaan e-RPH** (7 flowcharts describe the exact UI flow: DELIMa → Google Classroom → Google Sheets "tapak" → Turn in → grade 0/1).
- Existing Malaysian eRPH products: official DELIMa e-RPH, eRPH KPM v1 (AppSheet), school-built AppSheet apps (eRPH Sekolah Rendah / Cikgu Sarid, My ERPH, eRPH SK), Pandai Teacher, eRPH Pro, RPH365, Anak2U, RPH Helper.
- General UX research: NN/g form design & progressive disclosure, offline-first/PWA practice for low-connectivity environments.

---

## 2. Users & operating context (drives every front-end decision)

| Constraint | Implication for the UI |
|---|---|
| **Time-poor user** — RPH is written weekly for several classes/subjects, on top of teaching | Must reach "done" in minutes, not tens of minutes. Reuse/duplicate/clone is the #1 feature. |
| **Phone + laptop mix** — many teachers draft on a smartphone, some on school laptops | Mobile-first layout; the editor must be comfortable at 360 px width. |
| **Patchy connectivity** (rural/poor broadband) | Offline-first: draft without network, queue sync, explicit "waiting to upload" state. The official Garis Panduan explicitly allows offline filling then uploading. |
| **Low digital fluency in parts of the workforce; admins too** | Zero-learning-curve conventions (familiar Classroom-like patterns), plain Malay labels, inline help, no hidden gestures. |
| **Legal record** — RPH must be producible on demand for inspection (Akta 550, Peraturan 8) | Reliable **print/PDF export** that matches the KPM format exactly; never lose data. |
| **Role structure** — Guru, Guru Penyelaras, Pentadbir (GB/GPK), PPD/JPN | Distinct, role-aware front-ends (teacher view vs review queue vs monitoring dashboard) with simple RBAC. |
| **Weekly rhythm with a deadline** set by the school | Calendar/week-based IA, deadline badges, "not yet submitted" reminders, status at a glance. |
| **Personal/sensitive data** (school, class, teacher ID via DELIMa) | Clear privacy notice, PDPA-aware, no public sharing links by default. |

Personas worth designing against:
1. **Cikgu Aminah** — primary teacher, 4 classes, plans on a phone on the bus, has 15 min on Sunday night.
2. **Cikgu Rahman** — secondary, 5 subjects/streams, needs DSKP (Standard Kandungan/Pembelajaran) picker + KBAT/EMK fields.
3. **GPK (admin)** — reviews 30–60 RPH per week, needs a fast queue: open → scan → approve/comment → next.
4. **Guru Penyelaras** — needs school-wide completion stats and a way to chase non-submitters.

---

## 3. Audit of existing front-ends

### 3.1 Official: e-RPH on DELIMa (2025 →)
**Stack-as-UI:** a Google Sheets workbook ("tapak": tabs **MENU → RPT → harian**) submitted through **Google Classroom**, graded 0/1 with private comments.

- Flow (from Garis Panduan Lampiran 3–7): log in DELIMa → Classroom → join "e-RPH PENTADBIR" → make a copy of the template → rename `MINGGU n-NAMA GURU` → fill sheets → Classroom → Add or create → Google Drive → Turn in → admin grades in the **grades** tab.
- **Strengths:** zero new system to build/deploy; works on any device; offline via Google Drive offline mode; auditable trail; admins already know Classroom.
- **Weaknesses (front-end specific):**
  - A spreadsheet is not a form — no validation, no field-level guidance, easy to break formulas/formatting.
  - Multi-app navigation (DELIMa → Classroom → Drive → Sheets) = 4–5 context switches per weekly submission; the flowcharts themselves show how many steps there are.
  - Status is buried in Classroom "Grades"; no school-level dashboard.
  - File-name convention (`MINGGU 1-NAMA GURU`) is manual and error-prone; renames create duplicates.
  - Print fidelity depends on the teacher's spreadsheet formatting.

### 3.2 eRPH KPM v1 (AppSheet) and school AppSheet apps
Deck/list views over Google Sheets data, form-style record entry, roles per DELIMa email, Drive folder per teacher, print/notify actions.

- **Strengths:** real form UI + validation, phone-app feel, works offline (AppSheet offline cache), per-teacher folder organisation, admin view of all teachers, cheap to build (no-code).
- **Weaknesses:** generic AppSheet chrome (not tailored), performance with large sheets, limited design control, template/distribution economics (e.g. RM100 per school for the Cikgu Sarid app), dependency on the developer's Google account.

### 3.3 Commercial / third-party
| Product | Front-end notes |
|---|---|
| **Pandai Teacher** | Polished SaaS dashboard; "Lesson Plan – eRPH Creator" with **AI generation**, KSSR/KSSM aligned, class/student management, quiz builder, LADAP. 43k teachers, 24k eRPH crafted — proof that "generate then edit" is the interaction teachers want. |
| **eRPH Pro** | Marketing emphasises **"Sync DSKP effortlessly"** + dashboard ("dskpVerified") — i.e. the DSKP picker is the core screen. (Site was under maintenance during research.) |
| **RPH365** | Template marketplace + free "Rekod Transit PBD Online" tool whose feature list is a good UI checklist: auto-save, phone-friendly entry, analytics (TP distribution, completion %), Excel import/export, AES-256 encryption messaging. |
| **Anak2U** | Editable pre-made RPH/RPA + print & share; theme/asset library. |
| **RPH Helper** | Not a UI per se — a Google Sheets + ChatGPT workflow: upload Word RPH → parse → save as template → batch mode. Shows demand for **import/parse** of existing Word RPH. |

**Synthesis:** every successful product converges on the same four moves — (1) pick class/subject/date, (2) pick SK/SP from DSKP, (3) generate or clone the plan, (4) edit/export/submit. The official front-end makes the user do all four manually in a spreadsheet.

---

## 4. What the front-end of an *effective* eRPH must do

### 4.1 Information architecture (recommended screens)

```
Teacher
├── Minggu Ini (dashboard)        ← deadline, class tiles, status badges
│     └── "Mula RPH" / "Guna semula minggu lepas"
├── Editor RPH (wizard, 4 steps)
│     1. PROFIL  — kelas, tarikh, masa, subjek, tema/bidang
│     2. DSKP    — Standard Kandungan → Standard Pembelajaran picker
│     3. PdPc    — objektif, aktiviti, kaedah, EMK/KBAT, alat bantu
│     └── 4. REFLEKSI & intervensi → preview → hantar / simpan
├── Perpustakaan Templat          ← my templates, school bank, level templates
├── Sejarah / Arkib               ← search, duplicate, view submission status
└── Eksport                        ← PDF (KPM format), Word, print

Guru Penyelaras
├── Paparan Sekolah (completion %, by teacher, by week)
└── Peringatan (chase non-submitters)

Pentadbir (GPK/GB)
├── Semakan (review queue: next RPH → 1/0 + comment, keyboard-driven)
└── Laporan (weekly/monthly compliance export)

PPD/JPN (read-only aggregate)
└── Peta daerah/negeri
```

### 4.2 Interaction patterns to adopt (with rationale)

1. **Progressive disclosure wizard** for the RPH editor — 4 short steps instead of one 40-field page (NN/g: defer advanced/rarely used detail to secondary screens; reduces cognitive load and errors). EMK, KBAT, intervensi, alat bantu are "advanced" and collapsed by default.
2. **Single-column, labelled, validated forms** — NN/g's four principles (structure, transparency, clarity, support); inline validation on blur, not on submit; error text in Malay beside the field.
3. **Smart pickers, not free text:** DSKP picker cascading Tahun/Tingkatan → Bidang → Standard Kandungan → Standard Pembelajaran (searchable autocomplete); this is the single biggest time saver and the differentiator eRPH Pro markets.
4. **Clone/derive actions everywhere:** "Guna semula minggu lepas", "Guna semula untuk kelas lain" — turns a 20-minute job into a 2-minute edit. Pandai's AI generation is the same pattern taken further.
5. **Autosave with visible state** ("Disimpan 14:32 · Menunggu capaian internet") — never a Save button that can fail silently; explicit sync queue status for offline.
6. **Status as a first-class visual:** per-week badges (Draf / Menunggu / Disemak / Lengkap (1) / Tidak lengkap (0)) — replaces digging through Classroom grades.
7. **Review mode optimised for the GPK:** one screen with the RPH rendered (not a spreadsheet), Approve (1) / Reject (0) buttons, private comment box, `j`/`k` next-prev — reviews 40 RPH in minutes.
8. **Print/PDF fidelity:** a dedicated render (HTML→PDF or DOCX template) matching KPM's format, so on-demand inspection works and teachers don't fight spreadsheet pagination.
9. **Mobile-first responsive:** bottom nav, ≥44 px touch targets, sticky primary action, no horizontal scrolling in the editor; desktop adds split view (form left, live preview right).
10. **Malay-first UI copy** with correct KPM vocabulary (Standard Kandungan, Standard Pembelajaran, Refleksi, Intervensi, EMK, KBAT, PdPc); English toggle optional. Keep every label the teacher reads identical to the official form.
11. **Accessibility:** WCAG 2.2 AA — keyboard-operable wizard, focus states, contrast ≥4.5:1, screen-reader-friendly labels (admins and teachers with RDSK exist); dark mode is a nice-to-have, not a requirement.
12. **Progressive/zero-training help:** contextual "?" popovers and an embedded copy of the KPM flowcharts/FAQ; teachers must be able to self-serve.

### 4.3 Front-end architecture (technical recommendations)

| Concern | Recommendation |
|---|---|
| App shell | **PWA** (service worker + manifest) so it installs to the home screen and boots offline. Next.js/Vue+Vite SPA or Next.js with server components; either way, ship an offline shell. |
| Local data & sync | **IndexedDB (Dexie)** as source of truth on the client; mutation queue with last-write-wins/version vectors; background sync (`navigator.serviceWorker.sync`) when connectivity returns. Show queue depth in the UI. |
| Forms & validation | react-hook-form/zod (or VeeValidate/yup) — schema validation doubles as the KPM completeness rule engine ("profil, objektif, aktiviti, refleksi" = the FAQ's required set). |
| DSKP data | Versioned reference dataset (KSSR/KSSM DSKP) shipped as a local JSON index for offline search; updates via background fetch. |
| Export | Server-side PDF/DOCX generation from the same JSON model used by the on-screen preview (one source of truth = print never diverges from screen). |
| Interop | DELIMa/Google integration: sign-in with the DELIMa Google account (OpenID Connect) and optional "hantar ke Google Classroom" via Classroom API so submission still satisfies Surat Siaran 2/2025 even if your UI replaces Sheets. |
| Roles | Front-end route guards + server-enforced RBAC (Guru / Penyelaras / Pentadbir / PPD); admin screens render only what the role can act on. |
| Performance | Target <150 KB JS on first load for the editor, lazy-load heavy views; teachers on mid-range Androids and school desktops. Works on slow 3G: precache, no blocking web fonts, system font stack for Malay text. |
| Privacy | PDPA-aware: local-only drafts by default, no telemetry of RPH content, clear retention/deletion, encryption at rest (mirror RPH365's AES-256 messaging). |
| Design system | Small token-based system (spacing/colour/typography) + accessible primitives (Radix/shadcn or Ant Design Vue); keep the visual language calm and administrative — dense but legible tables for admin, card/tiles for teachers. |

### 4.4 Anti-patterns observed (avoid these)
- **Spreadsheets as UI** — no validation, no status, formula breakage, manual file renaming.
- **Deep multi-app journeys** (5 context switches to submit one document).
- **Weekly-printing-style mandates in the UI** — any design that adds ritual (print, physical sign-off) will be rejected by teachers; KPM already withdrew the printing order after backlash (May 2025).
- **Desktop-only admin tables** — GPKs review on phones too.
- **Free-text SK/SP fields** — kills searchability, analytics and DSKP alignment.
- **Silent data loss** — offline drafts must be provably stored (visible last-saved timestamp).

---

## 5. Minimal viable screen set (if you are building v1)

1. **Login** (DELIMa/Google SSO, role detection)
2. **Minggu Ini dashboard** — week selector, class tiles, status badges, deadline
3. **RPH editor** — 4-step wizard with DSKP autocomplete + autosave + offline queue
4. **Preview & Export** — KPM-format print view + PDF download
5. **Hantar** — one action to submit (locally + optional Classroom push)
6. **Semakan queue (admin)** — 1/0 + private comment, next/prev
7. **Paparan sekolah** — completion % table, export CSV

Everything else (AI generation, analytics, template marketplace, LADAP) is v2+.

---

## 6. How to measure "effective" (front-end metrics)
- **Time-to-first-RPH** for a new teacher (target: <5 min) and **median time per weekly RPH** (target: <5 min with clone).
- **Submission completion rate** per week vs deadline (this is the KPM-facing KPI).
- **Offline usage share** and sync-failure rate (validates offline-first).
- **Review throughput** (RPH approved per minute by admins).
- **Error/validation rate** — fields corrected after first validation pass.
- **Support/helpdesk contacts per 100 users** (the Garis Panduan makes the Guru Penyelaras the first line; a good UI should shrink this).
- **SUS score ≥ 68** with a mixed-experience teacher sample.

---

## 7. Sources
- KPM, *Surat Siaran KPM Bilangan 2 Tahun 2025* + *Garis Panduan Penyediaan e-RPH* (PDF, 21 pp., incl. Lampiran 1–7 flowcharts & Soalan Lazim): https://gurubesar.my/wp-content/uploads/2025/05/Surat-Siaran-Bilangan-2-Tahun-2025-eRPH-1.pdf
- eRPH KPM guide site (AppSheet/Google Sites v1): https://sites.google.com/moe-dl.edu.my/erph-kpmv1/menu
- Astro Awani/Bernama, "Guru tidak perlu cetak e-RPH setiap minggu – KPM" (1 May 2025): https://www.astroawani.com/berita-malaysia/guru-tidak-perlu-cetak-erph-setiap-minggu-kpm-518927
- eCentral, "e-RPH: Kelebihan & Cara Akses Dalam DELIMa": https://ecentral.my/e-rph/
- AppSheet template "eRPH Sekolah Rendah / Satu APPS untuk semua guru" (features: offline, Drive folder, print, notifications, admin view): https://www.appsheet.com/templates/Aplikasi-eRPH-Satu-APPS-untuk-semua-guru-
- Pandai Teacher (AI eRPH creator, KSSR/KSSM, 43k teachers / 24k eRPH): https://my.pandai.org/teachers/
- Pandai blog, "RPH & e-RPH: Panduan Lengkap Guru Malaysia": https://blog.pandai.org/rph-e-rph-panduan-lengkap-guru-malaysia/
- RPH365 (templates + free PBD tool feature set): https://rph365.com/
- Anak2U online lesson plan & teaching aid: https://anak2u.com.my/lesson-plan-teaching-aid/
- eRPH Pro ("Sync DSKP effortlessly", dashboard preview): https://erphpro.com/
- NN/g, "4 Principles to Reduce Cognitive Load in Forms": https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/
- NN/g, "Progressive Disclosure": https://www.nngroup.com/articles/progressive-disclosure/
- Offline-first/PWA for low-connectivity: https://www.growthjockey.com/blogs/offline-first-edtech , https://www.zorbis.com/why-progressive-web-apps-are-ideal-for-rural-low-connectivity-areas-blog.aspx
