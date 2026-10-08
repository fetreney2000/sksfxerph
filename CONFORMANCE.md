# Conformance Review — does the code implement the research?

_Method: every requirement in the five research documents and the UI mockup was
extracted and checked against the source with scripted greps plus manual code
reads. Comments were treated as claims to be verified, not evidence — several
early "wired" results were prose in a comment rather than a real call._
_Reviewed 4 October 2026 against the code at this commit._

---

## Verification gates

| Gate | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | clean (`strict` + `noUncheckedIndexedAccess`) |
| Lint/format | `npm run lint` | **0 errors**, 4 warnings (documented below) |
| Unit + component | `npm test` | **52 passed** (6 files, incl. password + session-token) |
| Build | `npm run build` | 14 routes, Next.js 16.3.8 |
| E2E | `npm run test:e2e` | **13 passed** (real Chromium, 0 console errors, incl. auth flows) |
| SQL static | `npm run check:sql` | 124 statements parse, 16 bodies balanced, 17/17 RLS, 26 policies, no schema-identifier leaks |
| SQL **executed** | `npm run check:sql:exec` | real PostgreSQL: objects, enum values, guard triggers, NULL-actor refusal |

### Supabase Auth removed (subsequent change)

Authentication was replaced wholesale with a local credential store:

| Was | Now |
|---|---|
| Supabase Auth (GoTrue), Google OAuth, `@supabase/ssr`, `proxy.ts` session refresh | `erph.user` (username + scrypt hash), `/api/auth/login`, httpOnly HMAC cookie |
| `auth.uid()` in 39 places | `erph.actor()` — honours `X-Erph-User` only for `service_role` callers |
| `profile` FK → `auth.users`, bootstrap trigger | `erph.user` standalone; trigger deleted |
| Browser → PostgREST with the user's JWT | Browser → our route handlers only; handlers use the secret key |
| — | `erph.user` **revoked from `anon`/`authenticated`**: hashes unreachable via API |

Consequences worth noting: **the route handlers are now the authorization
boundary** for privileged reads (service role bypasses RLS), with RLS kept as
defence-in-depth for anyone holding the publishable key; and `erph.actor()` is
the single place identity is resolved — `/api/heartbeat` reports `actor:
ok|broken` so the header round-trip is observable rather than assumed.
Verified by 16 new unit tests and 5 new e2e tests (gate redirect, wrong
password, login, logout, httpOnly).

---

## A · Findings fixed during this review

Each was a documented promise with no corresponding implementation.

| # | Gap found | Evidence it was real | Fix |
|---|---|---|---|
| 1 | **`submit_rph`, `review_rph`, `school_week_stats` were never called** — the three server-side business rules the backend doc builds its architecture on (§3.3 decision 4, §6) existed only in SQL | `grep` found zero call sites; only `sync_rph` was used | `lib/supabase/rpc.ts`; wired into editor submit, review grading, school dashboard — each with a local-mode fallback so no remote is still the design |
| 2 | **`sync_rph` could bypass the completeness gate** — it accepted any client-supplied `status`, so a `POST /api/sync` with `status:"submitted"` skipped `submit_rph`'s 100% rule | reading `db/schema.sql` update branch | Status now server-managed: client may only request `null` (keep) or `submitted` (only at 100%), and cannot move out of `approved`/`returned`. Re-validated with `db/validate.py` |
| 3 | **No mobile navigation** — sidebar is `hidden lg:flex`, so a phone had no visible nav except the undiscoverable ⌘K palette | grep for `BottomNav/Drawer/Sheet` → none | `components/shell/mobile-nav.tsx`, 48px targets, `pb-28` on `<main>` so content clears it |
| 4 | **Touch targets 38px** vs the ≥44px the frontend research specifies (§4.2(9)) | button `size.md = h-9.5` | `md → h-11` (44), `lg → h-12` (48), `sm → h-10` (40, documented: inline row actions, AA needs 24) |
| 5 | **Editor footer scrolled away** on long forms (§4.2(9) "sticky primary action") | no `sticky` in editor | `sticky bottom-14 lg:bottom-0` — clears the mobile nav |
| 6 | **Label → control association never wired** (§4.2(11) "screen-reader-friendly labels") | `htmlFor` accepted by `Label`, **zero** call sites passed one, **zero** controls had an `id` | 13 pairs wired with matching `htmlFor`/`id`; verified in-order by script |
| 7 | **`notification` table had no reader** — the bell only showed a toast | `db.notifications` existed, no UI | `components/shell/notifications.tsx`: unread count, panel, mark-one/mark-all read, Escape + outside-click dismiss |
| 8 | **Sync conflicts were silent** (§7 "surface the amber chip, don't hide it") | `reconcile()` returned conflicts, nothing read them | Server merging a plan into a different row now writes a **"Versi lain dikemas kini"** notification (one per flush, not one per row) |
| 9 | **`/api/export` had zero callers** — dead code; the DOCX route was unreachable | grep `api/export` → none | Editor now has **PDF** (browser print → save as PDF, offline-capable) and **DOCX** (downloads via the route, falls back to print) |
| 10 | **`export_file` never written** — the statutory audit trail for exports (§8/§10) | only a comment mentioned it | Fire-and-forget insert after generation, guarded by `supabaseConfigured`, failures logged |
| 11 | **"Garis panduan" opened `moe.gov.my` homepage**, not the guide (§4.2(12) self-serve help) | `window.open("https://www.moe.gov.my")` | Links the actual *Surat Siaran Bil. 2/2025 + Garis Panduan* PDF |
| 12 | **No contextual help** (§4.2(12) "contextual `?` popovers") | no Tooltip/Popover component | `HelpHint` disclosure (click/keyboard, not hover — phones) on the completeness meter and the DSKP picker |
| 13 | **Nothing scheduled `/api/heartbeat`** — the keep-alive that stops the free project auto-pausing (§2.2) is useless unscheduled | no `vercel.json` | `vercel.json` with `0 0 * * *` (Hobby: max 1×/day) |
| 14 | **No error boundary** (backend §11 observability) | no `error.tsx` | `app/error.tsx` (Malay message, retry, error digest) + `app/not-found.tsx` |
| 15 | **No rate limiting on anon endpoints** (backend §5 checklist) | none | `lib/http/rate-limit.ts`, sliding window, wired to `/api/sync`, JWT-subject keyed |
| 16 | **No component tests** (stack §10.2 promises DskpPicker/meter/buttons) | `tests/` had unit + e2e only | `tests/component/rph-paper.test.tsx` — 5 tests on the *statutory* render, incl. explicit "belum diisi" markers |
| 17 | **No offline edit → reload test** (stack §10.3) | e2e covered only the chip | Playwright: cut network → edit → assert queue state → reload → **assert the text came back from IndexedDB** |
| 18 | Biome had **84 errors** | — | 0 errors; 4 remaining warnings are `noArrayIndexKey` on controlled/static lists, downgraded with rationale in `biome.json` |

**Regression risk during the review:** one scripted fix (`_wire_labels`) corrupted `editor.tsx` via stale offsets. It was detected immediately by `tsc`, repaired, and the script rewritten to re-read the file per pair. This is exactly why the gates run on every change.

---

## B · Conformance by document

### `research-erph-malaysian-teachers.md` (domain)

| Requirement | Status |
|---|---|
| eRPH = digital RPH, KPM vocabulary throughout | ✅ `lib/i18n/ms.ts`, all labels match the Garis Panduan |
| Roles: guru / penyelaras / pentadbir (GPK) | ✅ `member_role` enum + route-scoped nav; full RBAC lives in RLS |
| Weekly submission rhythm with school-set deadline | ✅ `academic_calendar` + `currentWeek()`/`weekDeadline()` (one definition, test-enforced) |
| "Tiada keperluan mencetak setiap minggu" (May 2025 U-turn) | ✅ stated in the dashboard banner |
| RPH producible on demand (Peraturan 8, Akta 550) | ✅ `RphPaper` print path, DOCX export, `rph_revision` + `export_file` audit |
| Offline allowance for teachers | ✅ Dexie-first, offline e2e verified |

### `erph-frontend-research.md`

| § | Requirement | Status |
|---|---|---|
| 4.2(1) | 4-step progressive wizard | ✅ stepper + per-step completion |
| 4.2(2) | Labelled, validated forms; Malay errors | ✅ |
| 4.2(3) | DSKP picker: Tahun → Bidang → SK → SP | ⚠️ **partial** — SK search + SK→SP cascade work; the Tahun/Bidang pre-filter is not built (SQL has `dskp_standard.tahap`, the UI never reads it) |
| 4.2(4) | "Guna semula minggu lepas" / "untuk kelas lain" | ⚠️ week-clone ✅ (`reuseLastWeek`); "kelas lain" only exists as template-library copy |
| 4.2(5) | Autosave with visible state | ✅ saving indicator, no fail-silent Save button |
| 4.2(6) | Status as first-class visual | ✅ `StatusBadge` |
| 4.2(7) | Review mode: rendered RPH, 1/0, private comment, `j`/`k` | ✅ |
| 4.2(8) | Print/PDF fidelity | ✅ `RphPaper` + print CSS + DOCX route |
| 4.2(9) | Mobile-first: bottom nav, ≥44px, sticky action, split view | ✅ *(all four fixed in this review)* |
| 4.2(10) | Malay-first KPM copy | ✅ |
| 4.2(11) | WCAG: keyboard, focus, labels | ✅ labels wired; ⚠️ contrast never measured (needs Lighthouse) |
| 4.2(12) | Contextual `?` + embedded guide | ✅ `HelpHint` ×2 + guide PDF link |
| 4.4 | Anti-patterns absent (free-text SK/SP, desktop-only tables, print ritual) | ✅ all three |

### `erph-backend-research.md`

| § | Requirement | Status |
|---|---|---|
| 2.2 | Free tier, one school, $0 | ✅ profile adopted; no paid-only feature used |
| 3.2 | Schema: 17 tables / 26 policies / 16 functions | ✅ `db/schema.sql`, parser-validated |
| 5 | RLS everywhere, definer helpers, no same-table recursion, enum casts | ✅ validated by `db/validate.py` checks 3–5 |
| 6 | API surface: sync / export / heartbeat + RPCs | ✅ all four wired (export was dead code until this review) |
| 6 | Google Classroom push | ❌ **not implemented** — needs per-teacher OAuth grants; queued as v2 |
| 6 | Supabase Realtime for review status | ⚠️ polling via TanStack Query instead (free tier = 200 conns) |
| 7 | Offline protocol: `op_id`, batch ≤25, backoff, conflict surfaced | ✅ all four, incl. conflict notification added here |
| 8 | Storage private + signed URLs | ✅ in schema; UI exports stream direct from the route |
| 10 | `export_file` audit, retention, PDPA | ✅ export audit now written; retention job lives in `pg_cron` |
| 11 | Sentry, RLS test suite, load test | ⚠️ error boundary ✅; Sentry/`pgTAP` need external services or a local Postgres |

### `erph-frontend-stack.md`

| § | Requirement | Status |
|---|---|---|
| 3 | Rendering strategy per screen (RSC vs client) | ✅ dashboard/archive/reports RSC-shaped, editor/review client |
| 4 | Offline layer: Dexie → queue → `/api/sync`, SW never caches `/api/*` | ✅ verified by e2e |
| 7 | Hand-rolled SW fallback documented | ✅ implemented as the primary (Serwist caveat recorded) |
| 9 | Budget: ≤170 KB, excluded libs | ⚠️ excluded-lib discipline held; **budget not enforced in CI** (`@next/bundle-analyzer` not installed) |
| 10.1 | Unit tests incl. completeness ↔ SQL parity | ⚠️ 31 unit tests; parity by shared fixtures/comments — **SQL never executed** (no Docker/Postgres here) |
| 10.2 | Component tests | ⚠️ `RphPaper` covered; DskpPicker/keyboard not |
| 10.3 | E2E offline journey | ✅ added in this review |
| 10.4 | Cross-user RLS test | ❌ needs a live Supabase project |
| 10.5 | MSW | ❌ not adopted — Playwright covers route handlers; recorded as a deliberate omission |

### UI mockup (since removed)

The original high-fidelity mockup covered dashboard, editor, template library,
archive, review queue, school monitoring, command palette, submit dialog, dark
mode, offline chip and toast — **all present** and token-matched to
`app/globals.css`.

---

## C · Remaining gaps (deliberate or blocked)

| Gap | Why it's open | Next step |
|---|---|---|
| DSKP Tahun/Bidang pre-filter | demo dataset has no `tahap`; needs type + data + control | add `tahap` to `DskpStandard`, seed from `dskp_standard`, add a select above the SK search |
| Bundle budget in CI | dependency never installed | `npm i -D @next/bundle-analyzer`, wrap `next.config`, add `build:analyze` + size gate |
| Sentry / error tracking | needs a DSN | `@sentry/nextjs`; `app/error.tsx` already reports the digest |
| Cross-user RLS e2e + `pgTAP` | needs a live Supabase project | script with two test users once `.env.local` exists |
| Google Classroom push | needs per-teacher OAuth + Google verification | v2, per backend §6 |
| Realtime review channel | free tier = 200 conns | polling is correct at this scale; revisit if >1 school |
| Lighthouse CI a11y/contrast | needs a running URL + CI | add `.lighthouserc` against the preview deployment |
| Component tests for DskpPicker / keyboard grading | time | extend `tests/component/` |
| SQL-side completeness parity test | no local Postgres/Docker | run the shared fixtures through `rph_completeness()` in CI once a DB is available |

---

## D · Evidence

```bash
npm run verify        # tsc → biome → vitest(36) → next build → playwright(8)
python db/validate.py # 125 statements, plpgsql balanced, RLS + grants + erph-schema checks
```

All green at time of review: **0 lint errors · 52 tests · 13 e2e · 14 routes**.

### Finding: the schema failed on Supabase (follow-up)

The first real run failed with `type "member_role" does not exist` — invisible
to every static gate, because that statement *parses*; it only fails when
Postgres resolves it against `search_path`. Executing the schema against a
real PostgreSQL (the new `check:sql:exec` gate) surfaced the full set:

| Found | Fix |
|---|---|
| `role member_role` unqualified in `erph.user` (the reported error) | → `erph.member_role` |
| Bulk qualification leaked into **string literals**: enum value `'erph.school'`, audit entity `'erph.rph_document'` ×2, three error messages | reverted — schema qualifiers belong to code, never to data |
| `unaccent` extension declared but never used | removed |
| **`submit_rph` NULL-actor bypass**: `owner_id <> actor()` yields NULL when no actor resolves, and PL/pgSQL treats NULL in `IF` as *false* — so the "Tidak dibenarkan" branch was skipped and any publishable-key caller could submit another teacher's plan | explicit `actor() is null` guard **and** `IS DISTINCT FROM` |

Static guards added so the first three cannot recur: `db/validate.py` check [9]
rejects unqualified type references and any `erph.` inside a string literal;
`check:sql:exec` asserts enum values are intact, that the review-state guard
blocks a direct `UPDATE`, and that `submit_rph` refuses a NULL actor.
