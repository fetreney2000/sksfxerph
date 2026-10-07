# Back-End Research: Effective eRPH System on Supabase + Vercel

_Perspective: system developer. Planned stack: **Supabase (Postgres + Auth + Storage + Realtime + pg_cron)** as the database/BaaS, **Vercel** as the app host. Companion to `research-erph-malaysian-teachers.md` (domain) and `erph-frontend-research.md` (UI). Research date: 4 October 2026._

---

## 1. Architecture overview

```
┌────────────────────────────  Vercel  ────────────────────────────┐
│  Next.js (App Router) PWA                                        │
│  ├─ Server Components (dashboards, review queue — read via SDK)  │
│  ├─ Route Handlers /api/*  (PDF/DOCX export, sync, webhooks,     │
│  │                          AI generation, Classroom push)       │
│  ├─ Vercel Cron (external API calls, weekly digests)             │
│  └─ Edge Middleware (auth session refresh, role-based routing)   │
└───────────────┬──────────────────────────────────────────────────┘
                │  pooled PostgREST (Supavisor :6543) + Auth + Storage + Realtime
┌───────────────▼────────────────  Supabase  ──────────────────────┐
│  Postgres (source of truth, RLS enforced)                        │
│  ├─ profiles / school_members (roles)  ├─ schools / PPD / JPN    │
│  ├─ dskp reference (KSSR/KSSM)         ├─ classes & assignments  │
│  ├─ rph_documents (JSONB) + rph_revisions (append-only audit)    │
│  ├─ reviews (grade 0/1 + comment)      ├─ templates, calendars   │
│  └─ audit_log, exports                                                │
│  Auth (Google OAuth, @moe-dl.edu.my)   Storage (private buckets) │
│  Realtime (review status push)         pg_cron (deadlines, stats)│
│  Edge Functions (Deno: auth hooks, AI jobs)                      │
└──────────────────────────────────────────────────────────────────┘
        ▲
        │  offline mutation queue (IndexedDB → idempotent upserts)
   Teacher PWA (service worker)
```

**Division of labour (important):** Supabase Edge Functions run on **Deno** — you cannot run them inside Vercel. Keep it simple: *Vercel = everything HTTP/Next.js; Supabase = data, auth, storage, realtime, DB-side cron.* **Edge Functions are optional — the free plan allows only 2**, so default to Postgres triggers + Vercel handlers and reserve Edge slots for auth webhooks or a long AI job.

---

## 2. Platform limits & cost reality (2026)

| | Free (verified Oct 2026) | Paid |
|---|---|---|
| **Supabase Free** | 2 active projects; 500 MB DB + 50k MAU **per project**; 1 GB Storage; 5 GB egress; unlimited API requests; ~60 pooled (Supavisor) + 60 direct connections; Realtime 200 concurrent connections / 2M messages; **2 Edge Functions** (≈500k invocations, 2M function-seconds); `pg_cron` included; **no automated backups**; projects **auto-pause after ~7 days inactivity** | **Pro $25/mo**: 8 GB disk, 100k MAU, 250 GB bandwidth, **daily backups (7-day)**, more compute/connections/branches |
| **Vercel Hobby** | **Non-commercial use only**; fluid compute **300 s** default *and* max function duration; **cron jobs run at most once per day** (up to 100 cron entries/project); ~100 GB bandwidth; 100 builds/hour | **Pro $20/user/mo**: commercial use, higher/longer limits (default 300 s, configurable to 800 s, extended to 1800 s), sub-daily cron, WAF/rate limiting |

**Planning notes:**
- Volume math: a text RPH ≈ 10–30 KB as JSONB. **500 MB ≈ 15k–40k RPH documents** — fine for a pilot (a 500-teacher district × 40 weeks/yr × 5 plans ≈ 100k plans/yr → Pro needed, still cheap: 8 GB ≈ 300k+ docs).
- **If the product is commercial (paid for by schools/SaaS), Vercel Hobby is not allowed** — budget Pro from day one. Hobby is fine for a free/non-commercial internal tool or pilot.
- **Always connect with the pooled connection string** (Supavisor, port 6543) from Vercel serverless; direct connections (5432) exhaust fast. Keep a module-scoped client per lambda instance, never open pools inside request handlers.
- **Free project auto-pauses after ~7 days of inactivity, and pausing stops `pg_cron` too** — so the heartbeat must come from *outside*: the (daily) Vercel cron calls a `/api/heartbeat` route that runs a trivial query. Or go Pro for anything user-facing.
- **No automated backups on Free** — schedule a daily `pg_dump` GitHub Action (see §10).

### 2.1 Free-tier compatibility audit (do this → passes, don't → upgrade)

| Suggestion in this doc | Free-tier verdict | Adjustment |
|---|---|---|
| Postgres + PostgREST CRUD, RLS, RPCs | ✅ | core of the design; unlimited API requests |
| Supabase Auth (Google OAuth, 50k MAU) | ✅ | custom SMTP for OTP (free Resend/Brevo tier) |
| `pg_cron` inside Postgres (deadline flags, stat refresh, retention purge, heartbeat writes) | ✅ | any cadence is fine, runs on your compute |
| Supabase Realtime for review status | ✅ (200 conn) | small schools fine; SWR polling fallback for larger |
| Storage private buckets + signed URLs | ✅ (1 GB) | generate exports on demand (§8) |
| Offline sync route handler + revisions | ✅ | |
| **Vercel Serverless Route Handlers** | ✅ | fluid compute 300 s max on Hobby — plenty |
| **PDF/DOCX export server-side** | ⚠️ | **no Puppeteer/Playwright** (headless Chrome doesn't fit serverless free tier, heavy cold starts). Do: (a) **client-side** — print stylesheet / `@react-pdf/renderer` in the browser (also works **offline**), or (b) server-side **pure-JS** `docx`/`pdf-lib` in a route handler. Serve files **straight from Storage signed URLs** so bytes don't burn Vercel bandwidth |
| **Vercel Cron for reminders/digests** | ⚠️ | Hobby cron = **once per day only**. Design so *all* sub-daily scheduling lives in `pg_cron`; Vercel cron (1–2 daily jobs) only does network work: send digest email, push Classroom submissions, DB heartbeat |
| **Supabase Edge Functions** (auth hooks, AI jobs) | ⚠️ | Free = **2 functions**. Either skip Edge Functions entirely (do auth bootstrap in a Postgres trigger on `auth.users`, AI in a Vercel handler) or reserve the 2 slots for auth webhook + AI job |
| **DB preview branches per PR** | ❌ | paid feature → use your **second free project as staging** + local `supabase start`; or upgrade |
| **Automated daily backups / PITR** | ❌ | daily `pg_dump` GitHub Action → private repo artifact or Cloudflare R2 free tier (§10) |
| **AI generation (LLM)** | ⚠️ | LLM API usage is a separate bill — make it v2, quota-gated, or bring-your-own key |
| **Rate limiting / WAF** | ⚠️ | Vercel WAF is Pro → free alternative: Upstash Rate Limit (free tier) in middleware |
| Sentry, external email, Google Classroom API | ✅ | all have free tiers; Classroom API itself is free |

**Net: the whole core architecture (PWA + Vercel handlers + Supabase Postgres/Auth/Storage/pg_cron) runs comfortably on the two free tiers.** The only genuine blockers are commercial use (Hobby licence), automated DB backups, and preview branches — none of which block an MVP.

### 2.2 Target deployment: one school, non-commercial, $0

Chosen profile: internal tool for **your own school**, free to users, no revenue → **Vercel Hobby is fully permitted** (its restriction is only on commercial use), and every limit below has huge headroom.

| Resource | Free limit | Realistic single-school usage | Headroom |
|---|---|---|---|
| Supabase MAU | 50,000 | ~40–100 teachers/staff | ×500 |
| Supabase DB | 500 MB | ~80 teachers × ~200 RPH/yr ≈ 16k docs/yr; JSONB ~5–15 KB after TOAST compression ≈ **150–250 MB/yr** incl. revisions | ~2 years, then Pro or archive |
| Storage | 1 GB | only on-demand PDF/DOCX exports, short-lived signed URLs | ample if you don't store every export |
| Egress | 5 GB | exports come straight from Storage | ample |
| Pooler connections | ~60 | whole school logs in Monday 6–7 pm peak; fluid compute reuses connections | ample (design bursts as batched RPCs) |
| Realtime | 200 concurrent | admin review channels only (teachers don't need a live channel — use polling) | ample |
| Vercel bandwidth | ~100 GB | app shell + JSON payloads, files via Storage | ample |
| Vercel cron | 1×/day | exactly matches the design (daily digest + heartbeat + Classroom flush) | by design |
| Edge Functions | 2 | can skip entirely (Postgres triggers) or use both | by design |

**Practical notes for this profile:**
- **Single-tenant simplification:** keep `school_id` columns and RLS as designed (cheap now, saves a rewrite if the tool ever spreads to other schools), but you only need two roles in practice — `teacher` and `admin` (GPK/GB) — plus `coordinator` if you want one.
- **Keep the daily heartbeat cron** so the project never auto-pauses before the school term starts after a long holiday — a paused project means teachers get an error on Monday morning.
- **Backups still matter** (no automated backups on Free): the daily `pg_dump` GitHub Action is your insurance for a statutory record.
- **Growth path:** Pro ($25/mo) only when you outgrow 500 MB (~2 years of history) or want staging branches/daily backups for comfort — not because of user counts.
- Hobby deployments are public by default with a shared URL; use Vercel Deployment Protection (available on Hobby) or NextAuth middleware so only signed-in school staff see anything.

---

## 3. Domain data model

### 3.1 Entity relationship (logical)

```
auth.users ──1:1── profile ──< school_member >── school ──1:1── school_setting
                        │                      ├─< class ──< teaching_assignment >── subject
                        │                      ├─< academic_calendar
                        │                      ├─< rph_document ──< rph_revision  (append-only)
                        │                      │        └──────< rph_review       (grade 0/1 + comment)
                        │                      ├─< rph_template / notification / export_file
                        │                      └── audit_log                      (append-only)
                        └── sync_op                                              (idempotency)

shared reference: subject ──< dskp_standard (full-text + trigram search)
```

### 3.2 Implementation schema — `db/schema.sql`

The earlier sketch has been promoted to a **migration-ready SQL file: [`db/schema.sql`](db/schema.sql)** (Supabase / PostgreSQL 15). Objects live in a dedicated **`erph` schema**, not `public`: the schema is created and granted in-file, and every table/index/policy/function/view is explicitly qualified (`erph.school`, `erph.has_role(…)`) — qualification is mandatory, not cosmetic, because RLS policy expressions execute under the *requesting role's* search_path (`"$user", public`), where an unqualified helper would fail at runtime even though the migration applied cleanly. The clients in `lib/supabase/*` pass `db: { schema: "erph" }`, and the schema must additionally be added to **Settings → API → Exposed schemas**.

It was validated with the genuine PostgreSQL parser (`pglast` — libpg_query) plus [`db/validate.py`](db/validate.py): **125 statements, parse OK** — including checks that nothing of ours is created outside `erph`. Final gate before shipping: `supabase db reset` locally (needs Docker), because plpgsql bodies are type-checked only at execution.

**Inventory**

| Object | Count | Notes |
|---|---|---|
| Tables | 17 | org/identity (4), reference (3), teaching (3), RPH core (3), support (4) |
| Enum types | 5 | `member_role`, `rph_status`, `curriculum`, `template_visibility`, `notification_type` |
| Indexes | 21 | incl. 5 partial + 4 GIN (FTS/trigram) — every RLS policy column indexed |
| Functions / RPCs | 16 | 7 RLS helpers, 3 business RPCs, 2 domain, 4 trigger functions |
| Triggers | 10 | updated_at ×5, review-state guard, append-only ×3, auth bootstrap |
| RLS policies | 26 | SELECT-heavy; writes via owner policy or `security definer` RPC |
| Views | 2 | `v_teacher_week`, `v_school_compliance` (`security_invoker`) |
| Storage buckets | 2 | `rph-exports`, `attachments` (private, membership-scoped) |

**Entity relationship**

```
auth.users ──1:1── profile ──< school_member >── school ──1:1── school_setting
                        │                      │
                        │                      ├─< class ──< teaching_assignment >── subject
                        │                      ├─< academic_calendar
                        │                      ├─< rph_document ──< rph_revision  (append-only)
                        │                      │        └──────< rph_review      (grade 0/1 + comment)
                        │                      ├─< rph_template / notification / export_file
                        │                      └── audit_log                     (append-only)
                        └── sync_op                                            (idempotency)

shared reference:  subject ──< dskp_standard (FTS + trigram)
```

**Refinement log (v1 sketch → v2 schema)**

| # | Refinement | Why |
|---|---|---|
| 1 | `text + check` → **enum types** for closed sets (`rph_status`, `member_role`, …) | typo-proof, indexed smaller, PostgREST validates input |
| 2 | `class_id`, `subject_code` made **NOT NULL**; partial unique index `… where deleted_at is null` | Postgres treats NULLs as distinct → a nullable key silently breaks idempotency; now the unique index is a real natural key for sync merges |
| 3 | Added **derived columns**: `standard_kandungan`, `standard_pembelajaran`, `search_tsv`, `completeness` (all `GENERATED … STORED`) | filter/search/sort without JSONB parsing per row; two-arg `to_tsvector(regcfg,txt)` is immutable so it's legal in a generated column (`'simple'` config — no Malay dictionary) |
| 4 | **`rph_completeness(payload) → 0..100`** plus a coarse generated `completeness` for lists | exact KPM completeness check (profil/objektif/aktiviti/refleksi/intervensi) enforced by `submit_rph`; list views use the cheap projection |
| 5 | **`sync_op` idempotency table** + canonical-row resolution (by id *else* by natural key, with `unique_violation` merge) | offline retries replay safely; duplicate plans created under different client ids collapse into one row |
| 6 | **`guard_review_fields()` trigger** — `status`/`grade`/`reviewed_*` only change inside RPCs (`app.rpc='1'`) or trusted server code (`app.allow_review='1'`) | RLS cannot restrict *columns*; without this a client could PATCH `status='approved'` on its own row |
| 7 | **Policy helpers are SECURITY DEFINER** (`is_member`, `is_staff`, `has_role`, `shares_school_with`, `my_schools`, `class_in_school`, `teaches_class`) | inline subqueries on the *same* table inside its own policy = `infinite recursion detected in policy` error |
| 7b | `WITH CHECK` on owner INSERT/UPDATE also enforces `class_in_school(class_id, school_id)` + `school_id in my_schools()` | the FK alone lets a client pair its own class with a *foreign* `school_id` and plant a row in another tenant |
| 8 | `rph_owner_all FOR ALL` → **split select/insert/update, no DELETE policy** | owners must not hard-delete a statutory record; retention purge runs as service role with `app.purge='1'` |
| 9 | **`forbid_mutation()`** on `rph_revision` / `rph_review` / `audit_log` with an explicit purge switch | append-only enforced in the DB, not by convention; purge path still exists for the 5-year retention job |
| 10 | Review split: **`rph_review` history** (one row per decision, with `document_version` + checklist) + denormalised `grade/reviewed_by/reviewed_at` on the document | audit trail survives resubmissions; dashboards never join the history table |
| 11 | **`school_setting`** (session, submit weekday/time, timezone, `require_complete`) + `academic_calendar` | deadlines are school-configurable, never hard-coded in app logic |
| 12 | **No pupil (murid) table** — only `payload.bilangan_murid` | PDPA surface with zero benefit for lesson planning |
| 13 | `audit_log` captures submit/review with actor, ip, user agent; `export_file` records every PDF/DOCX produced | RPH is a legal record (Akta 550) — who saw/exported it must be answerable |
| 14 | Soft delete (`deleted_at`) + partial indexes on `deleted_at is null` | keeps rows for retention while excluding them from queries and the unique key |
### 3.3 Design decisions & rejected alternatives

**Chosen**

1. **JSONB `payload` for the plan body, not EAV or per-level tables.** The RPH form differs by level (prasekolah/rendah/menengah) and changes with KPM circulars; JSONB + generated columns + GIN keeps the schema stable while staying queryable. Identity/context columns stay relational for RLS and reporting.
2. **Optimistic concurrency (`version`) + append-only `rph_revision`.** The plan is a legal record (Akta 550) — offline writes merge last-write-wins, but every accepted write leaves a revision so nothing is ever silently overwritten.
3. **Client-generated UUIDs + `sync_op` idempotency.** An offline-created RPH arrives with its final id; replays are no-ops; natural-key collisions merge into a canonical row.
4. **Business rules in SECURITY DEFINER RPCs** (`submit_rph`, `review_rph`, `sync_rph`, `school_week_stats`). Completeness gates, KPM 0/1 grading, notifications and audit rows all happen atomically server-side; the client cannot half-apply a rule.
5. **School as tenant on every row** (`school_id`) — RLS, stats and backups stay one-liners even though v1 is single-school.
6. **Roles live in `school_member`, never in the JWT** — role changes take effect on the next query without token re-issue.
7. **School-configurable deadline** (`school_setting` + `academic_calendar`) instead of code-level week maths.
8. **No pupil-level data** — PDPA minimisation; the plan only needs a headcount.

**Rejected**

| Alternative | Why rejected |
|---|---|
| EAV / fully normalised objective + activity rows | form shape evolves per level; joins explode for a read that is always "one plan" |
| Storing reviews only as document columns | loses decision history (which version was judged, by whom, with what checklist) |
| Client-side `UPDATE status = 'approved'` guarded by RLS alone | RLS is row-scoped, not column-scoped → that is exactly why `guard_review_fields` exists |
| Roles embedded in JWT claims | stale roles after promotion/demotion until token refresh |
| Hard delete of documents | statutory retention; soft delete + purge job instead |
| A `student` / `enrollment` module | no lesson-planning value, meaningful PDPA cost |
| `english` FTS configuration | no Malay tsvector dictionary → use `simple` + `pg_trgm` |

---

## 4. Auth

- **Google OAuth restricted to the school domain** (`@moe-dl.edu.my`, and school Google Workspace domains if teachers use them). Supabase Auth supports `allowedEmailDomains` / a validate-hook; add magic-link fallback with custom SMTP (Supabase's built-in email is rate-limited — configure your own Resend/SES for OTP reliability).
- On first sign-in, an `auth.users` trigger (or Supabase Edge Function on `user.created`) inserts `profile` and, if the email matches an invite roster, `school_member` rows.
- **Roles live in the DB, not the JWT** (they change without re-issue). Use `security definer` helpers for policies:

```sql
create or replace function my_schools() returns uuid[]
language sql stable security definer as $$
  select coalesce(array_agg(school_id) from school_member where user_id = auth.uid(), '{}');
$$;

create or replace function has_role(p_school uuid, p_roles member_role[])
returns boolean language sql stable security definer as $$
  select exists (select 1 from school_member
                 where user_id = auth.uid() and school_id = p_school and role = any(p_roles));
$$;
```

- Server-side (Vercel) uses the **anon key + user JWT** (so RLS still applies) for user-context reads, and the **service-role key only in route handlers/webhooks** — never in client bundles, never in Server Components that could leak via cache.

---

## 5. Row Level Security (the security backbone)

Enable RLS on **every** table (Supabase exposes the whole schema via PostgREST; an unpoliced table is world-readable with the anon key). The complete set — **26 policies over 17 tables + 2 storage buckets** — lives in `db/schema.sql`. The pattern:

```sql
-- 1 · helpers are SECURITY DEFINER so policy expressions never re-enter RLS
--     (an inline subquery on the same table = "infinite recursion detected in policy")
create policy rph_owner_select on rph_document
  for select using (owner_id = auth.uid() and deleted_at is null);
create policy rph_owner_insert on rph_document
  for insert with check (owner_id = auth.uid());
create policy rph_owner_update on rph_document
  for update using (owner_id = auth.uid() and deleted_at is null)
  with check (owner_id = auth.uid());
-- deliberately NO delete policy: clients can't hard-delete a statutory record

-- 2 · school reviewers read everything in their school
create policy rph_reviewer_read on rph_document
  for select using (deleted_at is null
                    and has_role(school_id, array['admin','coordinator','ppd','jpn']::member_role[]));
--                                       ^ cast required: bare array['admin'] is text[] and the call fails

-- 3 · history tables (rph_revision, rph_review, audit_log) are SELECT-only:
--     writes happen inside SECURITY DEFINER RPCs, enforced in the DB by the
--     append-only forbid_mutation() trigger
```

**RLS performance & correctness checklist (the usual pitfalls):**
- **Never** write an inline subquery on the same table the policy belongs to → Postgres raises *infinite recursion detected in policy*. Use `security definer` helpers (`is_member`, `is_staff`, `has_role`, `shares_school_with`).
- **Cast enum arrays explicitly** (`array['admin']::member_role[]`); an uncast array literal resolves to `text[]` and the function call fails at `CREATE POLICY` time.
- **RLS is row-scoped, not column-scoped** — a client can PATCH its own row's `status`. Column guards (`guard_review_fields()`) belong in triggers.
- Every column referenced in a policy should be **indexed** (FK columns especially) — otherwise policies become seq scans per request.
- Views need **`security_invoker = true`** so they don't bypass table RLS.
- Force RLS for table owners in dev (`alter table ... force row level security;`) to catch leaks; add `pgTAP`/`supabase tests` cases for "teacher A must not read teacher B's RPH".
- Storage buckets need their **own policies** (`storage.objects`) with the path convention `rph-exports/<document_id>/…` / `attachments/<user_id>/…` — private buckets + short-lived signed URLs.
- Rate limiting isn't provided by Supabase: use Upstash Rate Limit (free tier) on anon-key endpoints, and monitor PostgREST logs.

---

## 6. API surface

| Concern | Where | Notes |
|---|---|---|
| CRUD (RPH, templates, classes) | **Supabase PostgREST** from client + server | RLS = authorization for free; use `select=...` sparse fieldsets and server-side RPCs for aggregates |
| Aggregates (school completion %) | **Postgres RPC / materialized view** | e.g. `school_week_stats(school_id, session)`; refresh via `pg_cron` |
| Offline sync | **Vercel Route Handler `/api/sync`** | receives an array of mutations, idempotent upserts, returns server versions/conflicts (see §7) |
| PDF/DOCX export | **Client-side PDF** (print stylesheet / `@react-pdf/renderer`) or **Vercel handler with pure-JS `docx`/`pdf-lib`** | No headless Chrome on free tier. 300 s Hobby limit is ample for pure-JS rendering. Store in Storage → return **signed URL** (file bytes don't transit Vercel) |
| AI generation (v2) | **Vercel Route Handler** (streaming) | keep prompts server-side; quota table; **skip Supabase Edge Functions unless you truly need them (free = 2)** — and if used, reserve them for auth webhook + this |
| Google Classroom push ("Hantar") | **Vercel Route Handler + daily Vercel Cron** | OAuth per teacher (encrypted refresh tokens) or school service account; jobs table + retry; Hobby cron fires **once/day** → queue submissions and flush daily, plus on-demand push on submit |
| Notifications / reminders | **`pg_cron` (DB)** computes due/overdue rows → **daily Vercel Cron** sends mail (free SMTP) | keeps sub-daily scheduling inside Postgres where it's free |
| Realtime review status | **Supabase Realtime** | 200 concurrent connections free; channel per school; SWR polling fallback |
| Auth hooks | **Postgres trigger on `auth.users`** (preferred) or 1 of your 2 Edge Function slots | bootstrap profile + memberships |

**Cron split (free-tier-safe):** `pg_cron` handles *everything sub-daily* (deadline flags every 15 min, stat refresh, retention purge) — it runs on your Supabase compute and has no free-tier cadence limit. **Vercel Cron on Hobby fires at most once per day per job**, so use 1–2 daily jobs only for network-bound work: send the reminder digest email, flush queued Classroom submissions, and hit `/api/heartbeat` so the free project never auto-pauses. Secrets live in Vercel env / Supabase Vault.

---

## 7. Offline sync protocol (client queue → server)

1. PWA writes mutations locally (Dexie/IndexedDB) with a **client-generated `op_id` (uuid)** and `client_updated_at`.
2. `POST /api/sync { op_id, entity, payload, base_version }` (batched array).
3. Server: upsert with `on conflict (natural key) do update ... returning version`.
   - Idempotent: `op_id` stored in `sync_op` table — replays are no-ops.
   - Conflict rule: if incoming `base_version < current version` → **LWW by `client_updated_at`**, always push a `rph_revision` row before overwriting, and flag `conflict: true` in the response so the UI can show "versi lain dikemas kini".
4. Response returns authoritative `version`/`updated_at`; client clears the op and shows "Disegerakkan".
5. Retry with exponential backoff; surface queue depth in the UI (per frontend research).
6. Teacher-facing reads can be optimistic (local first); admin dashboards read server truth.

---

## 8. Storage & files
- Buckets: `rph-exports` (PDF/DOCX, **private**, signed URLs 5–15 min), `attachments` (photos of teaching aids), `avatars`. Policies mirror RLS membership.
- **Generate-on-demand rather than store everything**: free tier = 1 GB storage and egress is metered (5 GB free). Store the export only when the teacher explicitly saves/shares.
- Migrations/backups of files: `supabase storage` is S3-compatible-ish; script exports nightly to a bucket you control if you fear lock-in.

---

## 9. Reference data (DSKP) pipeline
- Source: KPM DSKP documents (KSSR Semakan / KSSM). Build a parser → CSV/JSON → checked into git → `supabase db push` via GitHub Actions (Supabase CLI migrations = your schema's single source of truth). **Preview branches are a paid feature** → use your **second free project as staging** (migrations applied there by CI) plus local `supabase start` for PR-level checks.
- Version rows (`dskp_version`, `effective_date`) so old RPH remain interpretable.
- FTS with `simple` config + trigram (`pg_trgm`) for typo-tolerant Malay search.

---

## 10. Security, privacy, compliance (PDPA)
- RLS everywhere + least-privilege: anon key (client), service-role (server only, in Vercel env, never logged).
- **Audit log** for every state change (submit/approve/return) — needed since RPH is a statutory record.
- Data residency: choose a Supabase region near Malaysia (Singapore) — note this in the privacy notice.
- Soft-delete + retention policy (e.g. keep 5 years, purge with `pg_cron`), encryption at rest (platform default) + field-level encryption for OAuth refresh tokens (`pgcrypto` / Supabase Vault).
- **Backups (Free has none):** a GitHub Actions workflow runs `pg_dump` daily (connection via pooler, secret in repo) and commits to a **private** repo or uploads to a Cloudflare R2 free-tier bucket; test a restore quarterly. RPH is a statutory record — a restore path is not optional. `rph_revision` rows also give row-level history.
- Secrets: Vercel env vars + Supabase Vault; rotate on staff change; no secrets in Next.js `NEXT_PUBLIC_*`.
- Third parties: Google Classroom/Drive OAuth scopes minimised (`classroom.coursework.me`, `drive.file`), user-visible consent, token revocation path.

---

## 11. Observability & testing
- **Local dev:** `supabase start` (Docker) + `next dev`; migrations and seed scripts run identically to prod.
- **RLS test suite** (pgTAP or a TS harness with multiple service keys) — regression-test the "teacher can't see other schools" invariant on every PR.
- Sentry (client + server), Vercel logs/analytics, Supabase dashboard metrics; alert on pooler saturation (60 conns free tier) and p95 latency of the sync endpoint.
- Load test the two hot paths: weekly Sunday-night submission burst (sync upserts) and admin review queue reads.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Vercel Hobby non-commercial | **N/A for this project** (internal school tool, no revenue) — revisit only if you ever sell it |
| Supabase free project auto-pauses (~7 days idle) — `pg_cron` dies with it | **External** daily heartbeat: Vercel cron → `/api/heartbeat` (a trivial query) |
| No automated backups on Free | Daily `pg_dump` GitHub Action → private repo / R2 free tier; quarterly restore test |
| Vercel Hobby cron = once/day | All sub-daily scheduling in `pg_cron`; Vercel cron only for daily network jobs |
| Only 2 Edge Functions on Free | Prefer a Postgres trigger for auth bootstrap; reserve Edge slots if needed |
| 60 pooled connections / 200 Realtime conns | Pooled connection string, module-scoped client, RPCs for aggregates, polling fallback |
| Headless-Chrome PDF won't run on free serverless | Client-side print/PDF (works offline) or pure-JS `docx`/`pdf-lib` |
| Deno Edge Functions vs Vercel split confuses the team | Rule: only auth webhooks/AI jobs in Edge Functions; everything else Vercel |
| Google API verification & Classroom token refresh | Model teacher OAuth grants as first-class rows; batch push via Vercel cron; support manual "download & submit" fallback |
| JSONB payload becomes un-queryable soup | Add generated columns for fields you report on; keep versioned payload schema (`schema_version`) |
| RLS policy performance regressions | Index policy columns; EXPLAIN with `SET row_security = on`; budget review each migration |
| Lock-in | Plain Postgres (portable), migrations in git, exports to own storage bucket |

---

## 13. Build order (suggested)
1. Migrations: tenancy + auth triggers + RLS (with tests) — everything else depends on it.
2. Reference data seeds (DSKP) + calendar.
3. RPH CRUD + revisions + `/api/sync` idempotent upsert (offline loop closed).
4. Review queue + grades + realtime status.
5. Export (PDF/DOCX) + signed URLs.
6. Stats RPCs + admin dashboard + pg_cron reminders.
7. Google Classroom push, AI generation, template marketplace (v2).

## 14. Sources
- Supabase pricing/limits: https://supabase.com/pricing (Free: 500 MB DB, 50k MAU, 1 GB storage, 5 GB egress; Pro: 8 GB disk, 100k MAU, 250 GB bandwidth, daily backups)
- Supabase RLS guide: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase RLS production patterns: https://makerkit.dev/blog/tutorials/supabase-rls-best-practices
- Supabase Cron (pg_cron): https://supabase.com/modules/cron
- Supabase troubleshooting — connection limits (Supavisor pooler): https://supabase.com/docs/guides/troubleshooting/how-to-change-max-database-connections-_BQ8P5
- Vercel connection pooling with Functions: https://vercel.com/kb/guide/connection-pooling-with-functions
- Vercel function duration limits (fluid compute: Hobby 300 s default & max): https://vercel.com/docs/functions/limitations ; Vercel Hobby plan: https://vercel.com/docs/plans/hobby
- Vercel Cron usage & pricing (Hobby: max once per day): https://vercel.com/docs/cron-jobs/usage-and-pricing
- Supabase marketplace on Vercel: https://vercel.com/marketplace/supabase
- Next.js + Supabase background jobs (pg_cron vs Vercel cron): https://www.iloveblogs.blog/guides/nextjs-supabase-background-jobs-async-patterns
- Domain: KPM Surat Siaran Bil. 2 Tahun 2025 + Garis Panduan e-RPH (see `research-erph-malaysian-teachers.md` §6)
