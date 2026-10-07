# eRPH · Sistem Rancangan Pengajaran Harian

A working implementation of the electronic Daily Lesson Plan (Rancangan Pengajaran Harian) system for Malaysian teachers, built to the research in this repository and KPM's **Surat Siaran Bilangan 2 Tahun 2025**.

**Stack:** Next.js 16.3 (App Router) · React 19 · Tailwind v4 · Supabase (Postgres/RLS) · Dexie (IndexedDB) · Vercel

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Then sign in with the local-mode demo account — **`cikgu` / `cikgu123`**.

No configuration required. With no Supabase env vars the app runs in **local mode**: everything persists to IndexedDB, sessions still go through the real cookie/scrypt path (just against a bundled demo account), and the whole product works offline. See `.env.example` to enable syncing.

**Authentication is deliberately not Supabase Auth.** Accounts are rows in `erph.user` (username + scrypt hash), verified by `/api/auth/login`, and the session is an httpOnly HMAC cookie. See [Authentication](#authentication) below.

```bash
npm run verify       # typecheck → lint → unit tests → build → e2e
```

| Check | Command | Status |
|---|---|---|
| TypeScript | `npm run typecheck` | clean, `strict` + `noUncheckedIndexedAccess` |
| Lint/format | `npm run lint` | Biome, 0 errors (4 documented warnings) |
| Unit + component tests | `npm test` | 52 passing (incl. password + session-token) |
| Production build | `npm run build` | 14 routes |
| E2E | `npm run test:e2e` | 13 passing (incl. login, logout, session gate) |
| SQL schema | `python db/validate.py` | 125 statements, all RLS/grant checks pass |

## Authentication

```
browser ── httpOnly cookie ──> route handler ── secret key + X-Erph-User ──> Postgres
                                     │                                        │
                          verifies HMAC, loads erph.user            erph.actor() resolves
                          (is_active, password_changed_at)          the acting user for RLS
```

- **Credentials** live in `erph.user`: `username` (case-insensitive unique) and `password_hash` (PHC-style **scrypt**, N=16384 — Node stdlib, no bcrypt dependency).
- **Sessions** are stateless signed cookies (`sub.iat.exp` + HMAC). Revocation still works because every request re-reads the row: deactivating a user, or changing their password, kills existing cookies on the next request.
- **Login defences**: rate limit per IP (60/min — one key per source address, so a shared school NAT cannot lock colleagues out), 15-minute lockout after 5 failures *per account*, a dummy scrypt verify when the user doesn't exist (no timing oracle), LIKE-metacharacter escaping so `%` is a literal username, and one generic error message for unknown-user / wrong-password / inactive. The "account locked" message is only shown **after** a correct password — before that it would confirm the username exists.
- **`erph.actor()`** (db/schema.sql §3b) replaces `auth.uid()`: it reads the user id from the `X-Erph-User` header *only* when the caller has proven `service_role` (which requires the secret key), so a publishable-key caller cannot impersonate anyone.
- **`erph.user` is revoked from `anon`/`authenticated`** — password hashes never reach PostgREST, let alone RLS.

Adding a teacher (synced mode):

```sql
insert into erph.user (username, password_hash, full_name, role, email)
values ('nurul.aisyah', '<hash from scripts/hash-password.js>', 'Nurul Aisyah binti Rahim', 'teacher', '...');
-- then: insert into erph.school_member (school_id, user_id, role) values (...);
```

---

## What it does

| Screen | Route | Notes |
|---|---|---|
| Minggu Ini | `/minggu` | Deadline countdown, weekly PdP table, stats, activity feed |
| Editor RPH | `/editor/[id]` | 4-step wizard, DSKP picker, live A4 preview, completeness meter |
| Perpustakaan Templat | `/templat` | Reusable plans by level/subject |
| Sejarah & Arkib | `/arkib` | Weekly archive, statutory record note |
| Semakan RPH | `/semakan` | Review queue, keyboard grading (`J/K`, `1`, `0`) |
| Paparan Sekolah | `/sekolah` | School compliance, per-panel progress, teacher table |
| Laporan & Eksport | `/laporan` | PDF/CSV/DOCX export with audit trail |

Plus: `⌘K` command palette, dark mode, PWA install, service worker, offline sync queue.

---

## Architecture

```
Browser (Client Components, offline-first)
 ├─ Dexie / IndexedDB ─── local source of truth
 ├─ syncQueue ─────────── idempotent mutations (op_id)
 └─ Service worker ────── app-shell precache, never caches /api/*
        │  httpOnly session cookie (same-origin fetch — no token in JS)
        ▼
Vercel (Node route handlers) ── the ONLY thing that talks to the database
 ├─ /api/auth/*     → scrypt verify + sign session cookie
 ├─ /api/sync       → Supabase RPC `sync_rph`
 ├─ /api/rpc/*      → submit_rph / review_rph
 ├─ /api/queue      → submitted plans for the caller's school
 ├─ /api/stats      → school_week_stats RPC
 ├─ /api/export     → DOCX via `docx` (pure JS, no headless Chrome)
 └─ /api/heartbeat  → keeps the free-tier project from auto-pausing
        │  secret key + header  X-Erph-User: <user uuid>
        ▼
Supabase (PostgreSQL · schema `erph`)
 └─ db/schema.sql · RLS on every table · SECURITY DEFINER RPCs
    erph.actor()  ← resolves identity; honours the header ONLY for service_role
    submit_rph() / review_rph() / sync_rph() / school_week_stats()
```

**The rule that holds it together:** the client never touches the database. It writes to Dexie, then flushes a batch to a route handler that has already authenticated the cookie — and that handler passes the user id down, where `erph.actor()` and the RPCs re-check it. The client cannot skip a rule because there is no path from the browser to PostgREST.

### Key files

```
db/schema.sql               17 tables, 26 RLS policies, 16 functions (pglast-validated)
lib/server/auth/password.ts scrypt hashing/verification
lib/server/auth/token.ts    signed session cookie (pure, unit-tested)
lib/server/auth/session.ts  cookie → user, incl. revocation checks
lib/server/auth/guard.ts    requireUser / requireReviewer / schoolIdFor
lib/rpc.ts                  fetch wrappers for the RPC-backed routes
lib/schemas/rph.ts          Zod payload + completeness rules (mirrors SQL exactly)
lib/sync/queue.ts           offline queue: batch, backoff, reconcile
lib/config.ts               calendar-day tokens (one definition, test-enforced)
components/rph/editor.tsx   the 4-step wizard
```

---

## Two things worth reading before you change anything

**1. `completeness()` must agree with `rph_completeness()` in SQL.**
The editor shows the teacher a percentage; `submit_rph()` gates on the same number. If they drift, the UI promises something the server then refuses. `tests/unit/completeness.test.ts` documents each rule against its SQL equivalent.

**2. The calendar has exactly one definition.**
An earlier version deducted mid-term breaks in `currentWeek()` while `schoolDays()` did not — every deadline landed a month in the wrong place. `tests/unit/calendar.test.ts` now enforces that `currentWeek()` and `schoolDays()` are exact inverses and that every deadline is a **Friday 16:00 MYT**.

---

## Going from local mode to synced

1. `cp .env.example .env.local`, fill in the Supabase URL + publishable key.
2. Generate and set **`SESSION_SECRET`** (≥32 chars) — the app refuses to start without it once Supabase is configured:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
3. Set **`SUPABASE_SECRET_KEY`** (or legacy `SUPABASE_SERVICE_ROLE_KEY`) — server-only; route handlers use it for every query.
4. Apply `db/schema.sql` (Supabase SQL editor, or `supabase db push`). It creates — and grants — the dedicated **`erph` schema**; every object is schema-qualified because RLS policies evaluate under the *requesting role's* search_path, where an unqualified helper would not resolve. It also **revokes `erph.user` from `anon`/`authenticated`** so password hashes are unreachable through the API.
5. **Expose the schema**: Dashboard → Settings → API → *Exposed schemas* → add `erph`. Until this is done every REST call 404s, because PostgREST only searches the default exposed schema — the clients are already created with `db: { schema: "erph" }`.
6. Seed `erph.school`, `erph.school_member`, `erph.subject`, `erph.dskp_standard`, `erph.academic_calendar`, and create at least one `erph.user` row (hash from `scripts/hash-password.js`).
7. Deploy to Vercel; the daily cron in `vercel.json` calls `/api/heartbeat`.

> Verify the wiring in one request: `GET /api/heartbeat`. It reports
> `{"db":"ok","actor":"ok","mode":"synced"}` — `actor: broken` means PostgREST
> isn't surfacing the secret key's `service_role` role, so `erph.actor()` can't
> resolve the user id (see §3b of db/schema.sql).

> Verify the wiring in one query: `select * from erph.school limit 1;` from the
> SQL editor, then `GET /api/heartbeat` — it reports `{"db":"ok","mode":"synced"}`.

Free tier covers a whole school: 50k MAU, 500 MB DB (≈2 years of RPH), 100 GB Vercel bandwidth. See `erph-backend-research.md` §2.2.

---

## Research

| Document | Contents |
|---|---|
| `research-erph-malaysian-teachers.md` | Domain: what eRPH is, KPM policy, roles, pain points |
| `erph-frontend-research.md` | UX: audit of existing products, IA, interaction patterns |
| `erph-backend-research.md` | Supabase/Vercel limits, data model, free-tier audit |
| `erph-frontend-stack.md` | Stack decision matrix, rendering strategy, budget |
| `ui-mockup/index.html` | High-fidelity design mockup the implementation follows |
| `db/schema.sql` | Migration-ready schema (validated with PostgreSQL's own parser) |

---

## Tests

```bash
npm test          # unit: completeness, calendar, hash
npm run test:e2e  # browser: seeding, hydration, palette, editor, grading, SW
```

E2E runs against the production build (`playwright.config.ts` starts `next start` if needed).
