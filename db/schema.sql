-- ============================================================================
-- eRPH · Supabase / PostgreSQL 15 schema  ·  v2 (refined)
-- Sistem Rancangan Pengajaran Harian — single school, Supabase free tier
--
-- Conventions
--   * snake_case, uuid PKs (client pre-generates ids for offline sync)
--   * every tenant-owned row carries school_id → RLS becomes a one-liner
--   * server clock for all timestamps; client clock only via client_updated_at
--   * enums for closed value sets; check constraints for open sets
--   * business-rule writes go through SECURITY DEFINER RPCs; table policies
--     are mostly SELECT + owner-write
--
-- Section map
--   1 Extensions        8 RPCs (submit / review / sync / stats)
--   2 Enum types        9 Triggers (append-only guards)
--   3 Helpers          10 Indexes (inline with tables)
--   3b erph.actor()    11 Row Level Security
--   4 Org & identity   12 Storage buckets & policies
--   5 Reference data   13 Views
--   6 Teaching context 14 pg_cron jobs (commented)
--   7 Core documents   15 Expose schema + grants
--
-- Auth: Supabase Auth (GoTrue) is NOT used. Accounts are `erph.user`
-- (username + scrypt hash), sessions are signed cookies minted by our route
-- handlers, and `erph.actor()` (§3b) is the only way anything learns who is
-- making a request.
-- ============================================================================

-- ── 1 · EXTENSIONS ───────────────────────────────────────────────────────────
create extension if not exists pg_trgm;   -- typo-tolerant search on DSKP text
-- pg_cron is toggled per project in Supabase (Database → Extensions)

-- ── 1b · SCHEMA ─────────────────────────────────────────────────────────────
-- Everything lives in `erph`, NOT `public`, so the app's tables never collide
-- with extensions or other integrations that install into `public`, and the
-- blast radius of a mistaken grant is one schema instead of everything.
create schema if not exists erph;
--
-- Exposing it to the Data API is a two-step process (Supabase "Using custom
-- schemas"); the GRANTs are at the END of this file, after the objects exist:
--   1. Dashboard → Settings → API → Exposed schemas → add `erph`
--   2. run this file (the grants are part of it)
--
-- Every object below is schema-qualified on purpose. RLS policies evaluate
-- under the *requesting role's* search_path (`"$user", public`), so an
-- unqualified `is_member(...)` in a policy would not resolve at runtime even
-- though the migration applied cleanly.

-- ── 2 · ENUM TYPES ───────────────────────────────────────────────────────────
create type erph.member_role as enum (
  -- Renamed from teacher/coordinator/admin to the job titles people recognise.
  -- `pentadbir` is new: app set-up only, deliberately outside `is_staff`, so it
  -- can never review, monitor or read the audit log.
  'guru_biasa',   -- Guru Mata Pelajaran; writes and submits own RPH
  'gpk',          -- Guru Penolong Kanan; reviews and monitors
  'guru_besar',   -- PGB; approves what the GPK forwards
  'pentadbir',    -- Administrator; set-up and manage the app only
  'system'        -- seeded/service accounts
);

-- Two-stage approval: Guru Biasa submits -> GPK semak (forwarded) -> Guru Besar
-- lulus. `forwarded` is the plan sitting with the Guru Besar.
create type erph.rph_status as enum
  ('draft','submitted','forwarded','approved','returned');

create type erph.curriculum as enum ('KSSR','KSSM','PRASEKOLAH');

create type erph.template_visibility as enum ('private','school','system');

create type erph.notification_type as enum
  ('deadline','forwarded','returned','approved','reminder','system');

-- ── 3 · HELPERS (SQL functions used by triggers & policies) ──────────────────
create or replace function erph.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Append-only guard: UPDATE/DELETE blocked unless a purge switch is set
-- (retention job: select set_config('app.purge','1',true); …)
create or replace function erph.forbid_mutation()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.purge', true), '0') = '1' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  raise exception '% tidak dibenarkan pada %.% (jadual hanya boleh dibaca)',
    tg_op, tg_table_schema, tg_table_name;
end $$;

-- Review-state guard: status / grade / reviewed_* may ONLY change inside
-- SECURITY DEFINER RPCs (app.rpc='1') or trusted server code (app.allow_review='1').
-- Prevents a client from PATCHing status='approved' directly through PostgREST.
create or replace function erph.guard_review_fields()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and (new.status is distinct from old.status
          or new.grade is distinct from old.grade
          or new.reviewed_by is distinct from old.reviewed_by)
     and coalesce(current_setting('app.rpc', true), '0') <> '1'
     and coalesce(current_setting('app.allow_review', true), '0') <> '1'
  then
    raise exception 'Tukar status semakan melalui submit_rph()/semak_rph()/lulus_rph() sahaja';
  end if;
  return new;
end $$;

-- Completeness per KPM FAQ (profil SK/SP, objektif, aktiviti, refleksi, intervensi)
-- returns 0..100 → drives the editor progress meter and the submit gate
create or replace function erph.rph_completeness(p_payload jsonb)
returns smallint language plpgsql immutable as $$
declare
  v int := 0;
  v_act jsonb := coalesce(p_payload->'aktiviti', '[]'::jsonb);
begin
  if nullif(trim(coalesce(p_payload->>'standard_kandungan','')), '') is not null
     and nullif(trim(coalesce(p_payload->>'standard_pembelajaran','')), '') is not null
     and nullif(trim(coalesce(p_payload->>'objektif','')), '') is not null
  then v := v + 25; end if;

  if jsonb_typeof(v_act) = 'array' and jsonb_array_length(v_act) > 0
     and nullif(trim(coalesce((v_act->0)->>'aktiviti_guru','')), '') is not null
  then v := v + 25; end if;

  if nullif(trim(coalesce(p_payload->>'refleksi','')), '') is not null
  then v := v + 25; end if;

  if nullif(trim(coalesce(p_payload->>'intervensi','')), '') is not null
     or (jsonb_typeof(coalesce(p_payload->'emk', '[]'::jsonb)) = 'array'
         and jsonb_array_length(coalesce(p_payload->'emk', '[]'::jsonb)) > 0)
  then v := v + 25; end if;

  return v::smallint;
end $$;

-- ── 3b · WHO IS ACTING ──────────────────────────────────────────────────────
-- Single source of identity. Replaces `auth.uid()` because Supabase Auth
-- (GoTrue) is no longer used: accounts live in `erph.user`, sessions are our
-- own signed cookies, and no browser holds a Supabase JWT.
--
-- Two kinds of caller reach Postgres:
--
--   1. Someone with the PUBLISHABLE key hitting PostgREST directly (role
--      `anon`/`authenticated`). There is no `sub` in that token, so actor =
--      NULL and every RLS policy denies them. Deliberate: the browser must go
--      through our route handlers, and this is the backstop if it doesn't.
--
--   2. Our route handlers, authenticated with the SECRET key and identifying
--      the user via the `X-Erph-User` header.
--
-- The header is only honoured when the caller has already proven it holds the
-- secret key (`role = 'service_role'`, or `current_user` where the claims GUC
-- is absent). That proof comes from the key's signature, which is never
-- exposed to a browser — so a publishable-key caller cannot send
-- `X-Erph-User: <someone-else>` and impersonate them.
create or replace function erph.actor()
returns uuid
language plpgsql stable
set search_path = erph, public
as $$
declare
  v_claims jsonb;
  v_role   text;
  v_hdr    text;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;

  v_role := coalesce(v_claims->>'role', '');

  if v_role = 'service_role' or current_user = 'service_role' then
    -- Trusted path: read the identifying header, in whichever shape
    -- PostgREST exposes it (JSON object since v12, dotted GUC before that).
    begin
      v_hdr := nullif(current_setting('request.headers', true), '')::jsonb->>'x-erph-user';
    exception when others then
      v_hdr := nullif(current_setting('request.headers.x-erph-user', true), '');
    end;

    if v_hdr is not null
       and v_hdr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      return v_hdr::uuid;
    end if;
    return null;
  end if;

  -- Unprivileged path: only a genuine token subject counts.
  return nullif(v_claims->>'sub', '')::uuid;
exception when others then
  -- Any malformed claims/header must fail closed, never open.
  return null;
end $$;

-- ── 4 · ORG & IDENTITY ───────────────────────────────────────────────────────
create table erph.school (
  id          uuid primary key default gen_random_uuid(),
  kod_sekolah text unique not null,                    -- KPM school code (natural key)
  nama        text not null,
  level       text not null check (level in ('prasekolah','rendah','menengah','kembar')),
  ppd         text,                                    -- district name (kept simple on free tier)
  jpn         text,                                    -- state name
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table erph.user (
  id            uuid primary key default gen_random_uuid(),
  -- Credentials. Supabase Auth (GoTrue) is deliberately NOT used: accounts live
  -- here and passwords are verified by our own handler (lib/server/auth).
  username      text not null,                        -- case-insensitive (index below)
  password_hash text not null,                        -- PHC-style scrypt string
  role          erph.member_role not null default 'guru_biasa',
  is_active     boolean not null default true,
  failed_logins int not null default 0,               -- brute-force lockout
  locked_until  timestamptz,                          -- null = not locked
  password_changed_at timestamptz not null default now(),
  last_login_at timestamptz,

  full_name     text not null,
  email         text,                                 -- optional; login is by username
  moe_id        text,                                 -- staff/teacher id if known
  phone         text,
  locale        text not null default 'ms-MY',
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index profile_email_idx on erph.user (lower(email));
-- Login matches case-insensitively and `/api/admin/accounts` creates accounts
-- from a form, so uniqueness has to hold on the *lowercased* name: `Admin` and
-- `admin` are the same person, not two. Without this the second insert wins the
-- race and both name the same teacher.
create unique index user_username_uniq on erph.user (lower(username));

create table erph.school_member (
  school_id  uuid not null references erph.school(id) on delete cascade,
  user_id    uuid not null references erph.user(id) on delete cascade,
  role       erph.member_role not null default 'guru_biasa',
  title      text,                                      -- 'GPK Pentadbiran', 'Guru Matematik'
  invited_at timestamptz not null default now(),
  joined_at  timestamptz,
  is_active  boolean not null default true,
  primary key (school_id, user_id)
);
create index school_member_user_idx       on erph.school_member (user_id) where is_active;
create index school_member_school_role_idx on erph.school_member (school_id, role) where is_active;

create table erph.school_setting (
  school_id       uuid primary key references erph.school(id) on delete cascade,
  current_session text not null default '2026/2027'
                  check (current_session ~ '^[0-9]{4}/[0-9]{4}$'),
  submit_weekday  smallint not null default 5 check (submit_weekday between 1 and 7), -- 5 = Jumaat
  submit_time     time not null default '16:00',
  timezone        text not null default 'Asia/Kuala_Lumpur',
  require_complete boolean not null default true,      -- block submit below 100%
  updated_at      timestamptz not null default now()
);

-- ── 5 · REFERENCE DATA (seeded by CI; read-only to clients) ──────────────────
create table erph.subject (
  code       text primary key,                          -- 'MAT','BM','SAIN' …
  nama       text not null,
  curriculum erph.curriculum not null,
  is_active  boolean not null default true
);

create table erph.dskp_standard (
  id                    bigint generated always as identity primary key,
  dskp_version          int not null,                   -- e.g. 2026 (KSSR Semakan)
  curriculum            erph.curriculum not null,
  subject_code          text not null references erph.subject(code),
  tahap                 text not null,                  -- 'Tahun 5' / 'Tingkatan 3'
  bidang                text,
  kod_sk                text,                           -- '3.1'
  standard_kandungan    text not null,
  kod_sp                text,                           -- '3.1.1'
  standard_pembelajaran text not null,
  -- two-arg to_tsvector(regconfig, text) is IMMUTABLE → legal in a generated column.
  -- 'simple' config: Malay has no tsvector dictionary (never use 'english').
  search_tsv tsvector generated always as (
    to_tsvector('simple',
      coalesce(standard_kandungan,'') || ' ' ||
      coalesce(standard_pembelajaran,'') || ' ' ||
      coalesce(bidang,'') || ' ' || coalesce(kod_sk,'') || ' ' || coalesce(kod_sp,''))
  ) stored,
  unique (dskp_version, subject_code, tahap, kod_sk, kod_sp)
);
create index dskp_search_idx on erph.dskp_standard using gin (search_tsv);
create index dskp_trgm_idx   on erph.dskp_standard using gin (standard_kandungan gin_trgm_ops);
create index dskp_filter_idx on erph.dskp_standard (subject_code, tahap, dskp_version);

create table erph.academic_calendar (
  school_id       uuid not null references erph.school(id) on delete cascade,
  session         text not null check (session ~ '^[0-9]{4}/[0-9]{4}$'),
  week_no         smallint not null check (week_no between 1 and 52),
  start_date      date not null,
  end_date        date not null,
  submit_deadline timestamptz,
  label           text,                                 -- 'Minggu PTS', 'Minggu Peperiksaan'
  primary key (school_id, session, week_no),
  check (end_date >= start_date)
);

-- ── 6 · TEACHING CONTEXT ─────────────────────────────────────────────────────
create table erph.class (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references erph.school(id) on delete cascade,
  nama       text not null,                             -- '5 Amanah'
  tahun      smallint check (tahun between 1 and 6),
  tingkatan  smallint check (tingkatan between 1 and 6),
  session    text not null check (session ~ '^[0-9]{4}/[0-9]{4}$'),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, session, nama),
  check (tahun is not null or tingkatan is not null)
);
create index class_school_idx on erph.class (school_id, session);

create table erph.teaching_assignment (
  class_id     uuid not null references erph.class(id) on delete cascade,
  user_id      uuid not null references erph.user(id) on delete cascade,
  subject_code text not null references erph.subject(code),
  session      text not null,
  primary key (class_id, user_id, subject_code, session)
);
create index assignment_user_idx on erph.teaching_assignment (user_id, session);

-- NOTE on murid (pupils): deliberately NOT modelled in v1. RPH only needs the
-- class headcount (payload.bilangan_murid); pupil-level data would add PDPA
-- surface with zero benefit for lesson planning.

-- ── 7 · CORE DOCUMENT ────────────────────────────────────────────────────────
create table erph.rph_document (
  -- client pre-generates id offline → same id arrives at sync time
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references erph.school(id),
  owner_id         uuid not null references erph.user(id),
  class_id         uuid not null references erph.class(id),   -- wizard step 1 ⇒ NOT NULL
  subject_code     text not null references erph.subject(code),
  session          text not null check (session ~ '^[0-9]{4}/[0-9]{4}$'),
  week_no          smallint not null check (week_no between 1 and 52),
  plan_date        date not null,
  -- Lesson slot. Part of the document's identity (editor step 1), shown in the
  -- review queue, and edited offline — so it belongs beside plan_date rather
  -- than inside the free-form payload.
  slot_time        time not null default '07:30',
  status           erph.rph_status not null default 'draft',

  -- flexible body: shape differs by level and evolves with KPM circulars
  payload          jsonb not null default '{}'::jsonb,
  payload_version  smallint not null default 1,          -- bump when the form shape changes

  -- derived columns → filter/search/sort without parsing JSONB per row
  standard_kandungan    text generated always as (payload->>'standard_kandungan') stored,
  standard_pembelajaran text generated always as (payload->>'standard_pembelajaran') stored,
  search_tsv tsvector generated always as (
    to_tsvector('simple',
      coalesce(payload->>'standard_kandungan','') || ' ' ||
      coalesce(payload->>'standard_pembelajaran','') || ' ' ||
      coalesce(payload->>'objektif','') || ' ' ||
      coalesce(payload->>'refleksi',''))
  ) stored,
  -- coarse projection for list views; submit RPC recomputes with rph_completeness()
  completeness smallint generated always as (
    case
      when payload->>'standard_kandungan' is not null
       and payload->>'standard_pembelajaran' is not null
       and payload->>'objektif' is not null
       and payload->>'refleksi' is not null then 100
      when payload->>'objektif' is not null then 50
      else 0
    end
  ) stored,

  -- review denormalisation (authoritative history lives in rph_review)
  grade        smallint check (grade in (0,1)),
  reviewed_by  uuid references erph.user(id),
  reviewed_at  timestamptz,

  -- concurrency + offline sync
  version          int not null default 1,               -- optimistic lock, +1 per accepted write
  client_updated_at timestamptz not null default now(),  -- client clock (offline)
  content_hash     text,                                 -- skip no-op writes
  submitted_at     timestamptz,
  deleted_at       timestamptz,                          -- soft delete (statutory retention)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Idempotency key: one live plan per teacher×class×subject×week×date.
-- All key columns are NOT NULL, so the plain unique index behaves as expected
-- (PostgreSQL treats NULLs as distinct — which is why class_id/subject_code are NOT NULL).
create unique index rph_document_uniq
  on erph.rph_document (owner_id, class_id, subject_code, session, week_no, plan_date)
  where deleted_at is null;
create index rph_document_school_week_idx on erph.rph_document (school_id, session, week_no, status);
create index rph_document_owner_idx       on erph.rph_document (owner_id, session, week_no, plan_date)
  where deleted_at is null;
create index rph_document_queue_idx       on erph.rph_document (school_id, status, submitted_at)
  where deleted_at is null;
create index rph_document_search_idx      on erph.rph_document using gin (search_tsv);
create index rph_document_updated_idx     on erph.rph_document (updated_at desc);

-- Append-only revision trail (Akta 550 / Peraturan 8 ⇒ never rewrite history)
create table erph.rph_revision (
  id           bigint generated always as identity primary key,
  document_id  uuid not null references erph.rph_document(id) on delete cascade,
  version      int not null,
  payload      jsonb not null,
  completeness smallint not null check (completeness between 0 and 100),
  actor_id     uuid,                                     -- null = system/import
  reason       text not null check (reason in
                 ('create','edit','autosave','import','ai-generate','sync','resubmit')),
  created_at   timestamptz not null default now(),
  unique (document_id, version)
);

-- One row per review decision; the document keeps only the latest state
create table erph.rph_review (
  id               bigint generated always as identity primary key,
  document_id      uuid not null references erph.rph_document(id) on delete cascade,
  document_version int not null,                          -- which version was judged
  reviewer_id      uuid not null references erph.user(id),
  grade            smallint not null check (grade in (0,1)), -- KPM: 1 = lengkap, 0 = tidak
  comment          text,                                  -- "komen sulit" (teacher-visible)
  checklist        jsonb,                                 -- auto-check results at review time
  created_at       timestamptz not null default now()
);
create index rph_review_doc_idx     on erph.rph_review (document_id, created_at desc);
create index rph_review_reviewer_idx on erph.rph_review (reviewer_id, created_at desc);

-- ── 8 · TEMPLATES, NOTIFICATIONS, SYNC, EXPORTS, AUDIT ───────────────────────
create table erph.rph_template (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid references erph.school(id) on delete cascade,  -- null = system/global
  owner_id     uuid references erph.user(id) on delete set null,
  title        text not null,
  subject_code text references erph.subject(code),
  tahap        text,
  curriculum   erph.curriculum,
  payload      jsonb not null,
  visibility   erph.template_visibility not null default 'private',
  use_count    int not null default 0,
  cloned_from  uuid references erph.rph_template(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index rph_template_lookup_idx on erph.rph_template (school_id, subject_code, visibility);

create table erph.notification (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid references erph.school(id) on delete cascade,
  user_id    uuid not null references erph.user(id) on delete cascade,
  type       erph.notification_type not null,
  title      text not null,
  body       text,
  link_view  text,                                       -- deep-link target ('dashboard','review')
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notification_user_idx on erph.notification (user_id, read_at, created_at desc);

-- Sync idempotency: op_id is minted once on the client and replayed on retry
create table erph.sync_op (
  op_id     uuid primary key,
  user_id   uuid not null references erph.user(id) on delete cascade,
  entity    text not null,
  entity_id uuid not null,
  result    jsonb,
  applied_at timestamptz not null default now()
);
create index sync_op_user_idx on erph.sync_op (user_id, applied_at desc);

create table erph.export_file (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid references erph.rph_document(id) on delete cascade,
  school_id   uuid references erph.school(id) on delete cascade,
  bucket      text not null,
  path        text not null,
  format      text not null check (format in ('pdf','docx','zip')),
  bytes       int,
  created_by  uuid references erph.user(id),
  created_at  timestamptz not null default now()
);

create table erph.audit_log (
  id         bigint generated always as identity primary key,
  school_id  uuid,
  actor_id   uuid,
  entity     text not null,
  entity_id  uuid,
  action     text not null,                              -- 'submit','review','purge','login'
  before     jsonb,
  after      jsonb,
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_log_school_idx on erph.audit_log (school_id, created_at desc);
create index audit_log_entity_idx on erph.audit_log (entity, entity_id, created_at desc);

-- ── 9 · RPCs (SECURITY DEFINER = RLS-aware service layer) ────────────────────
-- Cross-tenant helpers are SECURITY DEFINER so policy expressions never
-- re-enter RLS on the same table (which Postgres rejects as infinite recursion).

create or replace function erph.is_member(p_school uuid)
returns boolean language sql stable security definer set search_path = erph, public as $$
  select exists (select 1 from erph.school_member
                 where user_id = erph.actor() and school_id = p_school and is_active);
$$;

create or replace function erph.is_staff(p_school uuid)
returns boolean language sql stable security definer set search_path = erph, public as $$
  select exists (select 1 from erph.school_member
                 where user_id = erph.actor() and school_id = p_school
                   and role in ('gpk','guru_besar') and is_active);
$$;

create or replace function erph.has_role(p_school uuid, p_roles erph.member_role[])
returns boolean language sql stable security definer set search_path = erph, public as $$
  select exists (select 1 from erph.school_member
                 where user_id = erph.actor() and school_id = p_school
                   and role = any(p_roles) and is_active);
$$;

create or replace function erph.my_schools()
returns uuid[] language sql stable security definer set search_path = erph, public as $$
  select coalesce(array_agg(school_id) filter (where is_active), '{}')
  from erph.school_member where user_id = erph.actor();
$$;

-- does `p_user` share a school with the caller, where the caller is staff?
create or replace function erph.shares_school_with(p_user uuid)
returns boolean language sql stable security definer set search_path = erph, public as $$
  select exists (
    select 1
    from erph.school_member a
    join erph.school_member b on a.school_id = b.school_id
    where a.user_id = erph.actor() and a.is_active
      and a.role in ('gpk','guru_besar')
      and b.user_id = p_user and b.is_active);
$$;

-- is this class in this school? used by rph_document WITH CHECK so a client
-- cannot plant a row into another tenant by pairing its own class with a
-- foreign school_id (the FK alone doesn't guarantee they agree)
create or replace function erph.class_in_school(p_class uuid, p_school uuid)
returns boolean language sql stable security definer set search_path = erph, public as $$
  select exists (select 1 from erph.class c where c.id = p_class and c.school_id = p_school);
$$;

-- may this caller draft for this class? lenient by design: assignment to the
-- class, OR staff of the class's school, OR any assignment within that school
-- (teachers cover classes ad hoc; the hard tenant boundary is class_in_school)
create or replace function erph.teaches_class(p_class uuid)
returns boolean language sql stable security definer set search_path = erph, public as $$
  select exists (
      -- direct assignment to this class
      select 1 from erph.teaching_assignment t
      where t.class_id = p_class and t.user_id = erph.actor()
    ) or exists (
      -- staff of the class's school
      select 1 from erph.class c where c.id = p_class and erph.is_staff(c.school_id)
    ) or exists (
      -- any assignment within the class's school (teachers cover classes ad hoc)
      select 1 from erph.class c
      where c.id = p_class
        and exists (
          select 1 from erph.teaching_assignment t2
          join erph.class c2 on c2.id = t2.class_id
          where t2.user_id = erph.actor() and c2.school_id = c.school_id)
    );
$$;

-- SUBMIT ─ enforce KPM completeness, stamp state, keep history
create or replace function erph.submit_rph(p_document uuid, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_pct smallint;
begin
  perform set_config('app.rpc', '1', true);              -- unlocks guard_review_fields

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;

  -- NULL-actor guard, matching sync_rph's.
  --
  -- This is load-bearing: `owner_id <> erph.actor()` evaluates to NULL when no
  -- actor can be resolved, and PL/pgSQL treats NULL in IF as false — so the
  -- "Tidak dibenarkan" branch would be skipped and ANY caller (including one with
  -- just the publishable key, for whom actor() is always null) could submit
  -- another teacher's plan. `IS DISTINCT FROM` never yields NULL.
  if erph.actor() is null then
    raise exception 'Belum log masuk';
  end if;

  -- owner OR staff (a GPK or Guru Besar may resubmit on the teacher's behalf)
  if v_doc.owner_id is distinct from erph.actor()
     and not erph.has_role(v_doc.school_id, array['gpk','guru_besar']::erph.member_role[])
  then raise exception 'Tidak dibenarkan'; end if;
  if v_doc.status = 'approved' then raise exception 'Telah disahkan lengkap'; end if;
  -- With the Guru Besar already: only the reviewer rung may move it from here.
  if v_doc.status = 'forwarded' then raise exception 'Sedang dalam kelulusan Guru Besar'; end if;

  v_pct := erph.rph_completeness(v_doc.payload);
  if v_pct < 100 and not p_force then
    return jsonb_build_object('ok', false, 'completeness', v_pct,
      'error', 'Refleksi/Intervensi belum lengkap');
  end if;

  update erph.rph_document
     set status = 'submitted', submitted_at = now(),
         grade = null, reviewed_by = null, reviewed_at = null,
         version = version + 1, client_updated_at = now()
   where id = p_document
  returning * into v_doc;

  insert into erph.rph_revision (document_id, version, payload, completeness, actor_id, reason)
  values (v_doc.id, v_doc.version, v_doc.payload, v_pct, erph.actor(), 'resubmit')
  on conflict (document_id, version) do nothing;

  insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
  values (v_doc.school_id, erph.actor(), 'rph_document', v_doc.id, 'submit',
          jsonb_build_object('completeness', v_pct, 'status', 'submitted'));

  return jsonb_build_object('ok', true, 'status', 'submitted', 'completeness', v_pct,
                            'version', v_doc.version);
end $$;

-- REVIEW ─ KPM Lampiran 7: 1 = lengkap, 0 = tidak lengkap
-- STAGE 1 — GPK semak. Accepting passes the plan up to the Guru Besar rather
-- than approving it; returning sends it straight back to the teacher.
create or replace function erph.semak_rph(p_document uuid, p_grade smallint,
                                          p_comment text default null)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_next erph.rph_status;
begin
  if p_grade not in (0,1) then raise exception 'Gred mesti 0 atau 1'; end if;
  perform set_config('app.rpc', '1', true);

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;
  if not erph.has_role(v_doc.school_id, array['gpk']::erph.member_role[]) then
    raise exception 'Peranan Guru Penolong Kanan diperlukan';
  end if;
  if v_doc.status <> 'submitted' then
    raise exception 'RPH tidak dalam peringkat semakan GPK';
  end if;

  v_next := case when p_grade = 1 then 'forwarded'::erph.rph_status
                 else 'returned'::erph.rph_status end;

  insert into erph.rph_review (document_id, document_version, reviewer_id, grade, comment, checklist)
  values (v_doc.id, v_doc.version, erph.actor(), p_grade, p_comment,
          jsonb_build_object('stage', 'gpk',
                             'completeness', erph.rph_completeness(v_doc.payload)));

  update erph.rph_document
     set status = v_next,
         grade = p_grade, reviewed_by = erph.actor(), reviewed_at = now(),
         version = version + 1
   where id = p_document;

  insert into erph.notification (school_id, user_id, type, title, body, link_view)
  values (v_doc.school_id, v_doc.owner_id,
          case when p_grade = 1 then 'forwarded'::erph.notification_type
               else 'returned'::erph.notification_type end,
          case when p_grade = 1 then 'RPH dihantar ke Guru Besar'
               else 'RPH perlu dibaiki' end,
          coalesce(p_comment, ''), 'dashboard');

  insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
  values (v_doc.school_id, erph.actor(), 'rph_document', v_doc.id, 'semak',
          jsonb_build_object('grade', p_grade, 'status', v_next, 'comment', p_comment));

  return jsonb_build_object('ok', true, 'grade', p_grade, 'status', v_next);
end $$;

-- STAGE 2 — Guru Besar lulus. Approves what the GPK forwarded, or returns it
-- to the teacher; a GPK cannot approve its own forwarding.
create or replace function erph.lulus_rph(p_document uuid, p_grade smallint,
                                          p_comment text default null)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_doc erph.rph_document%rowtype;
  v_next erph.rph_status;
begin
  if p_grade not in (0,1) then raise exception 'Gred mesti 0 atau 1'; end if;
  perform set_config('app.rpc', '1', true);

  select * into v_doc from erph.rph_document
   where id = p_document and deleted_at is null for update;
  if not found then raise exception 'RPH tidak dijumpai'; end if;
  if not erph.has_role(v_doc.school_id, array['guru_besar']::erph.member_role[]) then
    raise exception 'Peranan Guru Besar diperlukan';
  end if;
  if v_doc.status <> 'forwarded' then
    raise exception 'RPH belum disemak oleh Guru Penolong Kanan';
  end if;

  v_next := case when p_grade = 1 then 'approved'::erph.rph_status
                 else 'returned'::erph.rph_status end;

  insert into erph.rph_review (document_id, document_version, reviewer_id, grade, comment, checklist)
  values (v_doc.id, v_doc.version, erph.actor(), p_grade, p_comment,
          jsonb_build_object('stage', 'guru_besar',
                             'completeness', erph.rph_completeness(v_doc.payload)));

  update erph.rph_document
     set status = v_next,
         grade = p_grade, reviewed_by = erph.actor(), reviewed_at = now(),
         version = version + 1
   where id = p_document;

  insert into erph.notification (school_id, user_id, type, title, body, link_view)
  values (v_doc.school_id, v_doc.owner_id,
          case when p_grade = 1 then 'approved'::erph.notification_type
               else 'returned'::erph.notification_type end,
          case when p_grade = 1 then 'RPH diluluskan Guru Besar'
               else 'RPH perlu dibaiki' end,
          coalesce(p_comment, ''), 'dashboard');

  insert into erph.audit_log (school_id, actor_id, entity, entity_id, action, after)
  values (v_doc.school_id, erph.actor(), 'rph_document', v_doc.id, 'lulus',
          jsonb_build_object('grade', p_grade, 'status', v_next, 'comment', p_comment));

  return jsonb_build_object('ok', true, 'grade', p_grade, 'status', v_next);
end $$;

-- SYNC ─ batch, idempotent, offline-friendly; returns authoritative versions.
-- p_ops: [{op_id, id?, entity:'rph', class_id, subject_code, session, week_no,
--          plan_date, payload, status?, client_updated_at?, content_hash?}]
create or replace function erph.sync_rph(p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = erph, public as $$
declare
  v_op jsonb; v_op_id uuid; v_id uuid; v_uid uuid := erph.actor();
  v_school uuid; v_doc_id uuid; v_ver int; v_status erph.rph_status;
  v_rows int; v_pct smallint; v_client_ts timestamptz;
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Belum log masuk'; end if;
  perform set_config('app.rpc', '1', true);

  -- resolve caller's school once (all ops must belong to it)
  select school_id into v_school
    from erph.school_member where user_id = v_uid and is_active
   order by invited_at limit 1;
  if v_school is null then raise exception 'Tiada keahlian sekolah aktif'; end if;

  for v_op in select * from jsonb_array_elements(p_ops) loop
    v_op_id := (v_op->>'op_id')::uuid;
    v_id    := coalesce((v_op->>'id')::uuid, gen_random_uuid());
    v_pct    := erph.rph_completeness(v_op->'payload');
    v_client_ts := coalesce((v_op->>'client_updated_at')::timestamptz, now());

    -- 1) idempotency: replayed ops are no-ops
    insert into erph.sync_op (op_id, user_id, entity, entity_id)
    values (v_op_id, v_uid, 'rph', v_id)
    on conflict (op_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('op_id', v_op_id, 'result', 'duplicate'));
      continue;
    end if;

    -- 2) validate target class belongs to caller's school + session
    if not exists (
         select 1 from erph.class c
          where c.id = (v_op->>'class_id')::uuid
            and c.school_id = v_school and c.session = v_op->>'session' and c.is_active)
    then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('op_id', v_op_id, 'result', 'rejected',
                           'error', 'kelas bukan dalam sekolah/sesi anda'));
      continue;
    end if;
    if not exists (select 1 from erph.subject where code = v_op->>'subject_code') then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('op_id', v_op_id, 'result', 'rejected',
                           'error', 'mata pelajaran tidak dikenali'));
      continue;
    end if;

    -- 3) resolve canonical row: by id, else by natural key (merge duplicates)
    select id, version, status into v_doc_id, v_ver, v_status
      from erph.rph_document
     where owner_id = v_uid and deleted_at is null
       and (id = v_id
            or (class_id = (v_op->>'class_id')::uuid
                and subject_code = v_op->>'subject_code'
                and session = v_op->>'session'
                and week_no = (v_op->>'week_no')::smallint
                and plan_date = (v_op->>'plan_date')::date))
     order by (id = v_id) desc
     limit 1;

    if v_doc_id is not null then
      update erph.rph_document
         set payload = v_op->'payload',
             version = version + 1,
             client_updated_at = v_client_ts,
             slot_time = coalesce((v_op->>'slot_time')::time, slot_time),
             content_hash = coalesce(v_op->>'content_hash', content_hash),
             -- Status is server-managed. The client may request only:
             --   • nothing (null)     → keep current state
             --   • 'submitted'        → allowed ONLY when 100% complete
             -- Everything else (including leaving approved/returned) is dropped,
             -- so sync can never bypass submit_rph()'s completeness gate or
             -- let a teacher self-approve their own plan.
             status = case
                        when v_op->>'status' is null then status
                        when status in ('approved', 'returned')
                             and v_op->>'status' <> 'submitted' then status
                        when v_op->>'status' = 'submitted' and v_pct = 100
                          then 'submitted'::erph.rph_status
                        when v_op->>'status' = 'submitted' then status
                        else 'draft'::erph.rph_status
                      end,
             submitted_at = case when v_op->>'status' = 'submitted' and v_pct = 100
                                 and submitted_at is null
                                 then now() else submitted_at end
       where id = v_doc_id and owner_id = v_uid
      returning version, status into v_ver, v_status;
    else
      begin
        insert into erph.rph_document
          (id, school_id, owner_id, class_id, subject_code, session, week_no, plan_date,
           slot_time, payload, status, version, client_updated_at, content_hash, submitted_at)
        values
          (v_id, v_school, v_uid, (v_op->>'class_id')::uuid, v_op->>'subject_code',
           v_op->>'session', (v_op->>'week_no')::smallint, (v_op->>'plan_date')::date,
           coalesce((v_op->>'slot_time')::time, '07:30'::time),
           v_op->'payload',
           -- New documents are always drafts: submitting is an explicit act
           -- through submit_rph(), and the same 100% gate applies here.
           case when v_op->>'status' = 'submitted' and v_pct = 100
                then 'submitted'::erph.rph_status
                else 'draft'::erph.rph_status end,
           1, v_client_ts, v_op->>'content_hash',
           case when v_op->>'status' = 'submitted' and v_pct = 100 then now() end)
        returning id, version, status into v_doc_id, v_ver, v_status;
      exception when unique_violation then
        -- race: another request created the same logical plan → merge into it
        update erph.rph_document
           set payload = v_op->'payload',
               version = version + 1,
               client_updated_at = v_client_ts,
               slot_time = coalesce((v_op->>'slot_time')::time, slot_time)
         where owner_id = v_uid
           and class_id = (v_op->>'class_id')::uuid
           and subject_code = v_op->>'subject_code'
           and session = v_op->>'session'
           and week_no = (v_op->>'week_no')::smallint
           and plan_date = (v_op->>'plan_date')::date
           and deleted_at is null
        returning id, version, status into v_doc_id, v_ver, v_status;
      end;
    end if;

    if v_doc_id is null then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('op_id', v_op_id, 'result', 'rejected',
                           'error', 'tidak dapat menentukan dokumen'));
      continue;
    end if;

    insert into erph.rph_revision (document_id, version, payload, completeness, actor_id, reason)
    values (v_doc_id, v_ver, v_op->'payload', v_pct, v_uid, 'sync')
    on conflict (document_id, version) do nothing;

    update erph.sync_op set result = jsonb_build_object('id', v_doc_id, 'version', v_ver)
     where op_id = v_op_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'op_id', v_op_id, 'result', 'applied', 'id', v_doc_id,
      'version', v_ver, 'status', v_status, 'completeness', v_pct));
  end loop;

  return v_out;
end $$;

-- School compliance for one week (drives the admin dashboard in one round-trip)
create or replace function erph.school_week_stats(p_school uuid, p_session text, p_week smallint)
returns table (expected int, submitted int, approved int, returned_t int,
               drafts int, compliance numeric)
language plpgsql stable security definer set search_path = erph, public as $$
begin
  -- Any member: this returns counts and a percentage and never a name, so a
  -- Guru Biasa can see how the school is doing without seeing who is behind
  -- it. The per-teacher view lives behind `pantau` and is not served here.
  if not erph.is_member(p_school) and not erph.is_staff(p_school) then
    raise exception 'Tidak dibenarkan';
  end if;
  return query
  with t as (
    select count(*)::int n from erph.school_member
     where school_id = p_school and role = 'guru_biasa' and is_active
  ), d as (
    select status, grade from erph.rph_document
     where school_id = p_school and session = p_session
       and week_no = p_week and deleted_at is null
  )
  select
    (select n from t),
    (select count(*)::int from d where status <> 'draft'),
    (select count(*)::int from d where grade = 1),
    (select count(*)::int from d where status = 'returned' or grade = 0),
    (select count(*)::int from d where status = 'draft'),
    round(100.0 * coalesce((select count(*) from d where grade = 1), 0)
          / nullif((select n from t), 0), 1);
end $$;

-- ── 10 · ADMIN (app set-up) ───────────────────────────────────────────────────
-- Every handler runs as the secret-key role and therefore bypasses RLS, so
-- without these nothing below a DBA could ever change a role or a setting.
-- Putting the rules here keeps them auditable, and each refuses anyone who is
-- not the school's `pentadbir` before touching a row.
--
-- A password never reaches this section as anything but a PHC string: the
-- route hashes it with scrypt first (lib/server/auth/password.ts), so reading
-- these functions still yields no way back to what a teacher typed.

create or replace function erph.admin_list_members(p_school uuid)
returns table (user_id uuid, username text, full_name text, email text,
               role erph.member_role, is_active boolean,
               last_login_at timestamptz, locked_until timestamptz,
               failed_logins int, password_changed_at timestamptz)
language sql stable security definer set search_path = erph, public as $$
  select m.user_id, u.username, u.full_name, u.email, m.role, u.is_active,
         u.last_login_at, u.locked_until, u.failed_logins, u.password_changed_at
    from erph.school_member m
    join erph.user u on u.id = m.user_id
   where m.school_id = p_school and erph.has_role(p_school, array['pentadbir']::erph.member_role[])
   order by m.role, u.username;
$$;

-- Create an account and enrol it in the school in one step. Splitting the two
-- would leave a window where a user exists with no school — unable to sync,
-- review or report, and invisible to the very list that would fix it.
create or replace function erph.admin_create_member(p_school uuid, p_username text,
                                                    p_full_name text,
                                                    p_role erph.member_role,
                                                    p_password_hash text,
                                                    p_email text default null)
returns uuid language plpgsql security definer set search_path = erph, public as $$
declare
  v_id uuid;
  -- Login matches case-insensitively (`.ilike` in /api/auth/login), so the
  -- name is normalized here too: `GURU.BARU` must land on the "already used"
  -- check, not bounce off a format rule that rejects capitals the login
  -- screen would have accepted.
  v_username text := lower(trim(p_username));
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if p_role = 'system' then
    raise exception 'Peranan sistem tidak boleh diberikan kepada akaun';
  end if;
  if v_username !~ '^[a-z0-9._-]{3,32}$' then
    raise exception 'Nama pengguna: 3-32 aksara, huruf kecil, nombor, titik atau tanda hubung';
  end if;
  if nullif(trim(p_full_name), '') is null then
    raise exception 'Nama penuh diperlukan';
  end if;
  if p_password_hash is null or length(p_password_hash) < 20 then
    raise exception 'Kata laluan tidak sah';
  end if;
  -- Race backstop for the app-side check: `user_username_uniq` is what actually
  -- makes this hold when two tabs submit the same name at once.
  if exists (select 1 from erph.user u where lower(u.username) = v_username) then
    raise exception 'Nama pengguna ini telah digunakan';
  end if;

  insert into erph.user (username, password_hash, full_name, email, role)
  values (v_username, p_password_hash, trim(p_full_name),
          nullif(trim(p_email), ''), p_role)
  returning id into v_id;

  insert into erph.school_member (school_id, user_id, role)
  values (p_school, v_id, p_role);

  return v_id;
end $$;

-- Reset a forgotten password AND lock every session that still holds one:
-- `toUser` rejects a cookie issued before `password_changed_at`, so this is
-- "log out all devices" as a side effect rather than a separate step.
-- The lockout counters clear with it — otherwise a teacher who forgot their
-- password stays locked out of the new one.
create or replace function erph.admin_reset_password(p_school uuid, p_user uuid,
                                                     p_password_hash text)
returns void language plpgsql security definer set search_path = erph, public as $$
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if not exists (select 1 from erph.school_member
                 where school_id = p_school and user_id = p_user) then
    raise exception 'Akaun bukan ahli sekolah ini';
  end if;
  if p_password_hash is null or length(p_password_hash) < 20 then
    raise exception 'Kata laluan tidak sah';
  end if;

  update erph.user
     set password_hash = p_password_hash,
         password_changed_at = now(),
         failed_logins = 0,
         locked_until = null
   where id = p_user;
end $$;

-- Lift a brute-force lock without changing the password: the teacher knows
-- their password, they simply mistyped it five times.
create or replace function erph.admin_unlock_member(p_school uuid, p_user uuid)
returns void language plpgsql security definer set search_path = erph, public as $$
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if not exists (select 1 from erph.school_member
                 where school_id = p_school and user_id = p_user) then
    raise exception 'Akaun bukan ahli sekolah ini';
  end if;

  update erph.user set failed_logins = 0, locked_until = null where id = p_user;
end $$;

-- Sets the role and the active flag together. The role is duplicated on
-- `erph.user` (what the route guard reads) and `erph.school_member` (what SQL
-- reads) with nothing keeping them in step, so updating one alone would let a
-- demoted account keep its privileges through whichever layer it reached.
create or replace function erph.admin_set_member(p_school uuid, p_user uuid,
                                                 p_role erph.member_role,
                                                 p_active boolean)
returns void language plpgsql security definer set search_path = erph, public as $$
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if p_role = 'system' then
    raise exception 'Peranan sistem tidak boleh diberikan kepada akaun';
  end if;
  if not exists (select 1 from erph.school_member
                 where school_id = p_school and user_id = p_user) then
    raise exception 'Akaun bukan ahli sekolah ini';
  end if;
  update erph.school_member set role = p_role
   where school_id = p_school and user_id = p_user;
  update erph.user set is_active = p_active where id = p_user;
end $$;

-- The session is a real setting, not a build constant: turning the school year
-- over is the administrator's job, and it has to take effect for everyone at
-- once. Validated here because `school_setting.current_session` carries a CHECK
-- constraint that would otherwise surface to the UI as a raw Postgres error.
create or replace function erph.admin_set_setting(p_school uuid, p_weekday smallint,
                                                  p_time time,
                                                  p_require_complete boolean,
                                                  p_session text default null)
returns void language plpgsql security definer set search_path = erph, public as $$
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if p_weekday not between 1 and 7 then raise exception 'Hari mesti antara 1 dan 7'; end if;
  if p_session is not null and p_session !~ '^[0-9]{4}/[0-9]{4}$' then
    raise exception 'Sesi mesti dalam bentuk TTTT/TTTT';
  end if;
  update erph.school_setting
     set submit_weekday = p_weekday,
         submit_time = p_time,
         require_complete = p_require_complete,
         current_session = coalesce(p_session, current_session)
   where school_id = p_school;
end $$;

-- ── Classes ──────────────────────────────────────────────────────────────────
-- `rph_document.class_id` is NOT NULL and `sync_rph` refuses a class outside
-- the caller's school and session, so a class list the administrator cannot
-- edit means a class list nobody can ever plan against. This is the source the
-- editor reads — the demo fixtures in `lib/demo/seed.ts` are local-mode only
-- and their ids (`c-5a`) are not even valid UUIDs, so they must never reach sync.

create or replace function erph.admin_list_classes(p_school uuid, p_session text)
returns table (id uuid, nama text, tahun smallint, tingkatan smallint,
               is_active boolean, doc_count bigint)
language sql stable security definer set search_path = erph, public as $$
  select c.id, c.nama, c.tahun, c.tingkatan, c.is_active,
         (select count(*) from erph.rph_document d
           where d.class_id = c.id and d.deleted_at is null)
    from erph.class c
   where c.school_id = p_school and c.session = p_session
     and erph.has_role(p_school, array['pentadbir']::erph.member_role[])
   order by c.is_active desc, c.nama;
$$;

create or replace function erph.admin_set_class(p_school uuid, p_id uuid,
                                                p_nama text, p_tahun smallint,
                                                p_session text, p_active boolean)
returns uuid language plpgsql security definer set search_path = erph, public as $$
declare
  v_id uuid := p_id;
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if p_session !~ '^[0-9]{4}/[0-9]{4}$' then
    raise exception 'Sesi mesti dalam bentuk TTTT/TTTT';
  end if;
  if nullif(trim(p_nama), '') is null then
    raise exception 'Nama kelas diperlukan';
  end if;
  if p_tahun is not null and p_tahun not between 1 and 6 then
    raise exception 'Tahun mesti antara 1 dan 6';
  end if;

  if v_id is null then
    begin
      insert into erph.class (school_id, nama, tahun, session, is_active)
      values (p_school, trim(p_nama), p_tahun, p_session, coalesce(p_active, true))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Kelas "%s" sudah wujud dalam sesi ini', trim(p_nama);
    end;
  else
    -- Renaming onto a neighbour trips the same unique constraint, and swallowing
    -- it would report success while the name stayed put.
    begin
      update erph.class
         set nama = trim(p_nama),
             tahun = coalesce(p_tahun, tahun),
             is_active = coalesce(p_active, is_active)
       where id = v_id and school_id = p_school
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Kelas "%s" sudah wujud dalam sesi ini', trim(p_nama);
    end;
    if v_id is null then
      raise exception 'Kelas tidak dijumpai';
    end if;
  end if;

  return v_id;
end $$;

-- ── Subjects ─────────────────────────────────────────────────────────────────
-- Reference data the school turns on for the subjects it actually teaches.
-- Never deleted: `rph_document.subject_code` and `dskp_standard.subject_code`
-- both reference it, so a removal would take every plan written against it.
-- `is_active` is what the editor's subject picker reads.

create or replace function erph.admin_list_subjects(p_school uuid)
returns table (code text, nama text, curriculum erph.curriculum,
               is_active boolean, doc_count bigint)
language sql stable security definer set search_path = erph, public as $$
  select s.code, s.nama, s.curriculum, s.is_active,
         (select count(*) from erph.rph_document d
           where d.subject_code = s.code and d.deleted_at is null)
    from erph.subject s
   where erph.has_role(p_school, array['pentadbir']::erph.member_role[])
   order by s.curriculum, s.nama;
$$;

create or replace function erph.admin_set_subject(p_school uuid, p_code text,
                                                  p_active boolean)
returns void language plpgsql security definer set search_path = erph, public as $$
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if not exists (select 1 from erph.subject where code = p_code) then
    raise exception 'Mata pelajaran tidak dijumpai';
  end if;

  update erph.subject set is_active = p_active where code = p_code;
end $$;

create or replace function erph.admin_create_subject(p_school uuid, p_code text,
                                                     p_nama text,
                                                     p_curriculum erph.curriculum)
returns void language plpgsql security definer set search_path = erph, public as $$
begin
  if not erph.has_role(p_school, array['pentadbir']::erph.member_role[]) then
    raise exception 'Peranan pentadbir diperlukan';
  end if;
  if p_code !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'Kod subjek: 2-12 aksara huruf besar atau nombor';
  end if;
  if nullif(trim(p_nama), '') is null then
    raise exception 'Nama mata pelajaran diperlukan';
  end if;
  if exists (select 1 from erph.subject where code = p_code) then
    raise exception 'Kod subjek ini telah digunakan';
  end if;

  insert into erph.subject (code, nama, curriculum, is_active)
  values (p_code, trim(p_nama), p_curriculum, true);
end $$;

-- ── 11 · TRIGGERS ────────────────────────────────────────────────────────────
create trigger tr_school_updated   before update on erph.school
  for each row execute function erph.set_updated_at();
create trigger tr_profile_updated  before update on erph.user
  for each row execute function erph.set_updated_at();
create trigger tr_setting_updated  before update on erph.school_setting
  for each row execute function erph.set_updated_at();
create trigger tr_document_updated before update on erph.rph_document
  for each row execute function erph.set_updated_at();
create trigger tr_template_updated before update on erph.rph_template
  for each row execute function erph.set_updated_at();

-- review state may only move inside RPCs / trusted server code
create trigger tr_document_guard before update on erph.rph_document
  for each row execute function erph.guard_review_fields();

-- append-only enforcement (statutory record)
create trigger tr_revision_appendonly before update or delete on erph.rph_revision
  for each row execute function erph.forbid_mutation();
create trigger tr_review_appendonly   before update or delete on erph.rph_review
  for each row execute function erph.forbid_mutation();
create trigger tr_audit_appendonly    before update or delete on erph.audit_log
  for each row execute function erph.forbid_mutation();

-- ── 12 · ROW LEVEL SECURITY ──────────────────────────────────────────────────
-- PostgREST exposes every table in `erph`; an unpoliced table would be
-- world-readable to anyone holding the publishable key. Pattern: permissive
-- SELECT policies that call SECURITY DEFINER helpers (never inline subqueries
-- on the same table → recursion), writes only via owner policy or RPC.
--
-- Identity in every policy comes from `erph.actor()`, not `auth.uid()` — see
-- §3b. With no Supabase Auth in play, a direct PostgREST call resolves actor
-- to NULL and is denied outright; our own traffic arrives through route
-- handlers that authenticate first.
alter table erph.school              enable row level security;
alter table erph.user             enable row level security;
alter table erph.school_member       enable row level security;
alter table erph.school_setting      enable row level security;
alter table erph.subject             enable row level security;
alter table erph.dskp_standard       enable row level security;
alter table erph.academic_calendar   enable row level security;
alter table erph.class               enable row level security;
alter table erph.teaching_assignment enable row level security;
alter table erph.rph_document        enable row level security;
alter table erph.rph_revision        enable row level security;
alter table erph.rph_review          enable row level security;
alter table erph.rph_template        enable row level security;
alter table erph.notification        enable row level security;
alter table erph.sync_op             enable row level security;
alter table erph.export_file         enable row level security;
alter table erph.audit_log           enable row level security;

create policy school_read on erph.school
  for select using (erph.is_member(erph.school.id));

create policy setting_read on erph.school_setting
  for select using (erph.is_member(erph.school_setting.school_id));

create policy profile_read on erph.user
  for select using (id = erph.actor() or erph.shares_school_with(erph.user.id));
create policy profile_self_update on erph.user
  for update using (id = erph.actor()) with check (id = erph.actor());

create policy member_read on erph.school_member
  for select using (user_id = erph.actor() or erph.is_staff(erph.school_member.school_id));

-- reference data: read-only for any signed-in user
create policy subject_read   on erph.subject         for select to authenticated using (true);
create policy dskp_read      on erph.dskp_standard   for select to authenticated using (true);
create policy calendar_read  on erph.academic_calendar for select to authenticated using (true);

create policy class_read on erph.class
  for select using (erph.is_member(erph.class.school_id));

create policy assignment_read on erph.teaching_assignment
  for select using (
    user_id = erph.actor()
    or exists (select 1 from erph.class c where c.id = erph.teaching_assignment.class_id
                 and erph.is_staff(c.school_id))
  );

-- core document: owner may select/insert/update payload only — deliberately NO
-- delete policy (soft delete goes through server code), and status changes are
-- blocked by guard_review_fields even for the owner
create policy rph_owner_select on erph.rph_document
  for select using (owner_id = erph.actor() and deleted_at is null);
create policy rph_owner_insert on erph.rph_document
  for insert with check (
    owner_id = erph.actor()
    and school_id in (select unnest(erph.my_schools()))
    and erph.class_in_school(class_id, school_id)
    and erph.teaches_class(class_id)
  );
create policy rph_owner_update on erph.rph_document
  for update using (owner_id = erph.actor() and deleted_at is null)
  with check (
    owner_id = erph.actor()
    and school_id in (select unnest(erph.my_schools()))
    and erph.class_in_school(class_id, school_id)
  );
create policy rph_reviewer_read on erph.rph_document
  for select using (deleted_at is null
                    and erph.has_role(school_id, array['guru_besar','gpk']::erph.member_role[]));

-- history tables: SELECT only → writes happen inside SECURITY DEFINER RPCs
create policy rph_revision_read on erph.rph_revision
  for select using (exists (select 1 from erph.rph_document d
                            where d.id = erph.rph_revision.document_id
                              and (d.owner_id = erph.actor()
                                   or erph.has_role(d.school_id, array['guru_besar','gpk']::erph.member_role[]))));
create policy rph_review_read on erph.rph_review
  for select using (exists (select 1 from erph.rph_document d
                            where d.id = erph.rph_review.document_id
                              and (d.owner_id = erph.actor()
                                   or erph.has_role(d.school_id, array['guru_besar','gpk']::erph.member_role[]))));

create policy template_read on erph.rph_template
  for select using (
    owner_id = erph.actor()
    or (visibility = 'system' and erph.actor() is not null)
    or (visibility = 'school' and erph.is_member(erph.rph_template.school_id))
  );
create policy template_insert on erph.rph_template
  for insert with check (owner_id = erph.actor() and visibility <> 'system');
create policy template_update on erph.rph_template
  for update using (owner_id = erph.actor()) with check (owner_id = erph.actor());

create policy notification_read on erph.notification
  for select using (user_id = erph.actor());
create policy notification_mark_read on erph.notification
  for update using (user_id = erph.actor()) with check (user_id = erph.actor());

create policy sync_op_read on erph.sync_op
  for select using (user_id = erph.actor());

create policy export_read on erph.export_file
  for select using (
    created_by = erph.actor()
    or exists (select 1 from erph.rph_document d where d.id = erph.export_file.document_id
                 and (d.owner_id = erph.actor()
                      or erph.has_role(d.school_id, array['guru_besar','gpk']::erph.member_role[])))
  );

create policy audit_admin_read on erph.audit_log
  for select using (erph.has_role(erph.audit_log.school_id, array['guru_besar','gpk']::erph.member_role[]));

-- ── 13 · STORAGE (private buckets, membership-scoped signed URLs) ────────────
insert into storage.buckets (id, name, public) values
  ('rph-exports', 'rph-exports', false),
  ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- path convention: rph-exports/<document_id>/<file>.pdf
--                  attachments/<user_id>/<file>
--
-- KNOWN DORMANT STATE — read before using these buckets.
-- These policies call erph.has_role() → erph.actor(), and erph.actor() only
-- honours a caller-supplied identity for `service_role`. Storage requests do
-- not arrive through PostgREST with our X-Erph-User header, so as written
-- every check resolves to NULL and every read is DENIED. That is the correct
-- default (fail closed) and costs nothing today because no code path touches
-- Storage — exports stream straight from /api/export.
--
-- Before enabling uploads/downloads: either proxy Storage through a route
-- handler (same pattern as every other DB access), or extend erph.actor() with
-- a Storage-specific identity source. Do not simply relax the policy to
-- `using (true)` — the buckets would then be readable by anyone holding the
-- publishable key.
create policy storage_read on storage.objects
  for select to authenticated using (
       (bucket_id = 'rph-exports'
        and exists (select 1 from erph.rph_document d
                     where d.id::text = (storage.foldername(name))[1]
                       and (d.owner_id = erph.actor()
                            or erph.has_role(d.school_id, array['guru_besar','gpk']::erph.member_role[]))))
    or (bucket_id = 'attachments'
        and (storage.foldername(name))[1] = erph.actor()::text)
  );
create policy storage_upload_attachments on storage.objects
  for insert to authenticated with check (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = erph.actor()::text
  );

-- ── 14 · VIEWS (security_invoker ⇒ RLS still applies through the view) ───────
create view erph.v_teacher_week
with (security_invoker = true) as
select d.school_id, d.owner_id, d.session, d.week_no,
       count(*) filter (where d.status = 'draft')     as drafts,
       -- 'submitted' means "has left the teacher", including the stage with the
       -- Guru Besar; only `approved` counts as done.
       count(*) filter (where d.status in ('submitted','forwarded')) as submitted,
       count(*) filter (where d.status = 'approved')  as approved,
       count(*) filter (where d.status = 'returned')  as returned,
       round(avg(d.completeness), 1)                  as avg_completeness
from erph.rph_document d
where d.deleted_at is null
group by 1,2,3,4;

create view erph.v_school_compliance
with (security_invoker = true) as
select d.school_id, d.session, d.week_no,
       count(*)                                as total_docs,
       -- keyed on status, not `grade`: a GPK's grade-1 "accepted" sits at
       -- `forwarded` and is not an approval until the Guru Besar signs it.
       count(*) filter (where d.status = 'approved')                as approved,
       count(*) filter (where d.status = 'returned')                as rejected,
       count(*) filter (where d.status in ('submitted','forwarded')) as pending,
       round(100.0 * count(*) filter (where d.status = 'approved')
             / nullif(count(distinct d.owner_id), 0), 1) as compliance_pct
from erph.rph_document d
where d.deleted_at is null
group by 1,2,3;

-- ── 15 · pg_cron JOBS (enable after seeding the calendar) ────────────────────
-- -- Thursday 20:00: nudge teachers with incomplete drafts
-- select cron.schedule('erph-deadline-nag', '0 20 * * 4', $$
--   insert into erph.notification (school_id, user_id, type, title, body, link_view)
--   select distinct sm.school_id, sm.user_id, 'deadline',
--          'RPH belum lengkap',
--          'Mohon lengkapkan sebelum Jumaat 4:00 petang', 'dashboard'
--   from erph.school_member sm
--   join erph.rph_document d on d.owner_id = sm.user_id and d.school_id = sm.school_id
--   where sm.role = 'guru_biasa' and sm.is_active
--     and d.status = 'draft' and d.completeness < 100
--     and d.deleted_at is null
--     and d.session = '2026/2027';
-- $$);
--
-- -- Daily 00:10: retention purge for soft-deleted rows older than 5 years
-- select cron.schedule('erph-retention', '10 0 * * *', $$
--   select set_config('app.purge','1',true);
--   delete from erph.rph_document where deleted_at < now() - interval '5 years';
-- $$);
--
-- NOTE (free tier): pg_cron runs inside Supabase — any cadence is free.
-- The KEEP-AWAKE heartbeat must come from OUTSIDE (Vercel daily cron →
-- GET /api/heartbeat → trivial query), because a paused project stops pg_cron too.

-- ── 16 · EXPOSE THE SCHEMA TO THE DATA API ─────────────────────────────────
-- Required by Supabase's "Using custom schemas" guide. PostgREST connects as
-- `authenticator` and switches to `authenticated`/`anon`; without USAGE on the
-- schema and privileges on its objects, every request 404s even though RLS
-- would have allowed it.
--
-- Order matters: `GRANT ... ON ALL ...` covers what exists now, while
-- `ALTER DEFAULT PRIVILEGES` covers everything created later by this role.
-- Run step 1 of the two-step setup first:
--   Dashboard → Settings → API → Exposed schemas → add `erph`
grant usage on schema erph to anon, authenticated, service_role;
grant all on all tables in schema erph to anon, authenticated, service_role;
grant all on all routines in schema erph to anon, authenticated, service_role;
grant all on all sequences in schema erph to anon, authenticated, service_role;
alter default privileges for role postgres in schema erph
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema erph
  grant all on routines to anon, authenticated, service_role;
alter default privileges for role postgres in schema erph
  grant all on sequences to anon, authenticated, service_role;

-- NOTE: granting broadly is correct here because RLS is the real guard — the
-- same model Supabase itself uses for `public`. Every table in this schema has
-- RLS enabled (see §11), and writes go through SECURITY DEFINER RPCs.
--
-- EXCEPT `erph.user`: it holds password hashes, so it is revoked outright from
-- the API roles. The service role (route handlers, SECURITY DEFINER functions)
-- keeps access; PostgREST clients get "permission denied" before RLS is even
-- consulted. Column-level grants would still leak via PostgREST metadata, so
-- the whole table goes.
revoke all on erph.user from anon, authenticated;
