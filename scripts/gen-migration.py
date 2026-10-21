"""Emit db/migrations/001_roles_and_two_stage.sql from db/schema.sql.

The schema file is not idempotent (create type / create table / create policy),
so an existing project cannot simply re-run it. This pulls the *definitions
that changed* straight out of schema.sql — never hand-copied — and wraps them
in the DDL an existing database needs.

    python scripts/gen-migration.py
"""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
sql = (root / "db" / "schema.sql").read_text(encoding="utf-8")

FUNCTIONS = [
    "is_staff",
    "shares_school_with",
    "submit_rph",
    "school_week_stats",
    "admin_set_member",
    "admin_set_setting",
    # Lives here rather than beside its other callers because two functions
    # emitted *earlier* in the chain than its own migration call it:
    # `admin_create_member` (002) validates the office a new account is born
    # with. plpgsql resolves a call when the function runs, not when it is
    # created — but a database that had run 002 and not yet the migration that
    # introduces `erph.jawatan` would raise on the first account created. It
    # is created twice, in 001b and again in 012, which `create or replace`
    # turns into no more than a re-assertion.
    "jawatan_for",
]

# `admin_list_members` reads `school_member.supervisor_id`, and `language sql`
# bodies are validated when they are created — so it cannot be born before the
# column that column does not exist yet. It therefore has no home in 001b or
# 002 and is created by 004, immediately after the column arrives.
LATE_FUNCTIONS = ["admin_list_members"]

# Replaced by erph.sahkan_rph / erph.hantar_balik_rph in migration 004, when
# the GPK → Guru Besar hop disappeared. Listed here only so the drop can be
# generated: `create or replace` never removes anything.
RETIRED = [
    "semak_rph(uuid, smallint, text)",
    "lulus_rph(uuid, smallint, text)",
]

# Functions whose *shape* changed since the previous migration. `create or
# replace` cannot handle either kind of change:
#
#   · a different return type raises "cannot change return type of existing
#     function" — `admin_list_members` gained four columns;
#   · an added parameter makes Postgres treat it as a *different* function, so
#     the old one lingers as an overload and `admin_set_setting(school, 5,
#     '16:00', true)` would keep resolving to it — silently ignoring the
#     session the caller just set.
#
# Dropping first is therefore not tidiness, it is the only way the new
# definitions actually take effect. `if exists` makes the drop safe on a
# database that never had them.
CHANGED_SHAPE = [
    "admin_list_members(uuid)",
    "admin_set_setting(uuid, smallint, time, boolean)",
]

# Dropped by 001b alone: 002 emits `CHANGED_SHAPE` and does not recreate what
# it drops there, so a function that only 001b (and later 013) creates would
# be left missing for the rest of the chain.
ONLY_IN_001B = [
    # The return type gained `teachers`; the baseline already has a
    # `school_week_stats`, so `create or replace` refuses outright (42P13).
    "school_week_stats(uuid, text, smallint)",
]

# DDL for migrations beyond 001, generated from the same source so nothing is
# ever hand-copied out of schema.sql.
ADMIN_FUNCTIONS = [
    "admin_create_member",
    "admin_reset_password",
    "admin_unlock_member",
    "admin_set_member",
    "admin_list_classes",
    "admin_set_class",
    "admin_list_subjects",
    "admin_set_subject",
    "admin_create_subject",
    "admin_set_setting",
]

# Policies that embed a role literal. After the rename the old literals do not
# exist, so evaluating one of these would raise rather than merely deny.
# The three scope-limited read policies are deliberately **absent**. They call
# erph.may_supervise, which does not exist until 004 — it needs the supervision
# column first — and `create policy` resolves its expression at creation time.
# Emitting them here would fail, and leaving rph_document unreadable between
# 001b and 004 is the correct fail-closed state rather than an oversight: the
# drop list above still removes any older copies, and 004 puts the new ones in.
POLICIES = [
    ("export_read", "erph.export_file"),
    ("audit_admin_read", "erph.audit_log"),
    ("storage_read", "storage.objects"),
]

VIEWS = ["v_teacher_week", "v_school_compliance"]


def function(name: str) -> str:
    # The body is `as $$ … $$;` for SQL functions and `as $$ … end $$;` for
    # plpgsql; either way `$$;` appears exactly twice and the first one is the
    # terminator.
    m = re.search(rf"create or replace function erph\.{re.escape(name)}\(.*?\$\$;", sql, re.S)
    if not m:
        raise SystemExit(f"function erph.{name} not found in db/schema.sql")
    return m.group(0)


def policy(name: str) -> str:
    m = re.search(rf"create policy {re.escape(name)} on [\s\S]*?;", sql)
    if not m:
        raise SystemExit(f"policy {name} not found in db/schema.sql")
    return m.group(0)


def view(name: str) -> str:
    """Extract a view definition, stopping at the first real terminator.

    A comment inside the body can contain a semicolon (`-- Guru Besar;`), so a
    regex up to `;` truncates the statement mid-flight.
    """
    m = re.search(rf"create view erph\.{re.escape(name)}", sql)
    if not m:
        raise SystemExit(f"view erph.{name} not found in db/schema.sql")
    out = [sql[m.start() :].splitlines()[0]]
    for ln in sql[m.start() :].splitlines()[1:]:
        if ln.strip().startswith("--"):
            continue
        out.append(ln)
        if ln.strip().endswith(";"):
            break
    return "\n".join(out)


DIR = root / "db" / "migrations"
DIR.mkdir(parents=True, exist_ok=True)

# ── A: the ALTER TYPE statements, deliberately alone ──────────────────────────
# These cannot ride along with the rest, so they get their own file: pasting
# the whole migration at once is exactly the mistake this split prevents.
alter_a = DIR / "001a_alter_types.sql"
alter_a.write_text(
    """-- ============================================================================
-- eRPH · MIGRATION 001a — role and status values (RUN ONE LINE AT A TIME)
-- ============================================================================
-- Run BEFORE 001b_schema_delta.sql, and run it by selecting a single line and
-- pressing Run each time. Two Postgres rules make that unavoidable:
--
--   · `alter type ... rename value` refuses to run inside a transaction block,
--     and the SQL editor wraps a pasted script in one.
--   · a value added inside a transaction cannot be used until it commits —
--     001b defines functions that reference `pentadbir` and views that
--     reference `forwarded`, so both must exist before it starts.
--
-- Six lines. Each should report "ALTER TYPE".
-- ============================================================================

alter type erph.member_role rename value 'teacher'     to 'guru_biasa';
alter type erph.member_role rename value 'coordinator' to 'gpk';
alter type erph.member_role rename value 'admin'       to 'guru_besar';
alter type erph.member_role add value if not exists 'pentadbir';
alter type erph.rph_status add value if not exists 'forwarded';
alter type erph.notification_type add value if not exists 'forwarded';
""",
    encoding="utf-8",
)

OUT = DIR / "001b_schema_delta.sql"

body = f"""-- ============================================================================
-- eRPH · MIGRATION 001b — the schema delta (paste this whole file)
-- ============================================================================
-- Run AFTER 001a_alter_types.sql, which must be run one line at a time.
--
-- For a Supabase project created before commit e46e870. A fresh install needs
-- none of this: db/schema.sql already describes the end state.
--
-- §2 creates the `erph.jawatan` type and column ahead of the migration that
-- backfills it, because 002 and 004 name them in signatures they cannot be
-- created without.
--
-- Generated by scripts/gen-migration.py from db/schema.sql, so the definitions
-- below cannot drift from the schema they are migrating towards.
--
--   python scripts/gen-migration.py
-- ============================================================================

-- ── 1 · column defaults ────────────────────────────────────────────────────
alter table erph.user         alter column role set default 'guru_biasa';
alter table erph.school_member alter column role set default 'guru_biasa';

-- ── 2 · columns added after the original delta ──────────────────────────────
-- Created here rather than in the migration that first needs them, because
-- later definitions in this chain name them in a signature or in a body that
-- is checked when the function is created: `admin_create_member`'s parameter
-- and `admin_list_members`' return type name `erph.jawatan`, and
-- `admin_set_setting`'s parameter and the two statistics functions read
-- `school_setting.rph_per_week`. A database that already ran the original
-- 001b gets both from the later migrations; every statement is guarded, so
-- whichever runs second changes nothing.

-- The office printed on the cover sheet.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'erph' and t.typname = 'jawatan'
  ) then
    create type erph.jawatan as enum (
      'guru_biasa', 'pk_pentadbiran', 'pk_hem', 'pk_kokum', 'guru_besar'
    );
  end if;
end $$;

alter table erph.user add column if not exists jawatan erph.jawatan;

-- How many RPH one teacher owes in a week — the denominator behind
-- "pematuhan sekolah", five for a school that runs Monday to Friday.
alter table erph.school_setting
  add column if not exists rph_per_week smallint not null default 5;

alter table erph.school_setting drop constraint if exists school_setting_rph_per_week_check;
alter table erph.school_setting add constraint school_setting_rph_per_week_check
  check (rph_per_week between 1 and 7);

-- ── 3 · the single-stage reviewer is gone ──────────────────────────────────
drop function if exists erph.review_rph(uuid, smallint, text);

-- ── 4 · helpers, RPCs and the new admin set-up ─────────────────────────────
-- Shapes that changed: these cannot be `create or replace`d over.
{chr(10).join(f"drop function if exists erph.{sig};" for sig in CHANGED_SHAPE + ONLY_IN_001B)}

{chr(10).join(chr(10) + function(n) + chr(10) for n in FUNCTIONS)}
-- ── 5 · policies embedding a role literal ─────────────────────────────────
drop policy if exists rph_reviewer_read on erph.rph_document;
drop policy if exists rph_revision_read on erph.rph_revision;
drop policy if exists rph_review_read on erph.rph_review;
drop policy if exists export_read on erph.export_file;
drop policy if exists audit_admin_read on erph.audit_log;
drop policy if exists storage_read on storage.objects;

{chr(10).join(policy(n) + chr(10) for n, _ in POLICIES)}
-- ── 6 · views (keyed on status, so a GPK's grade-1 is not an approval) ─────
drop view if exists erph.v_teacher_week;
drop view if exists erph.v_school_compliance;

{chr(10).join(view(n) + chr(10) for n in VIEWS)}
-- ── 7 · accounts ───────────────────────────────────────────────────────────
-- The district/state roles are gone from the app. Postgres cannot drop an enum
-- value at all, so deleting the rows is what keeps the data honest — leaving
-- them would mean two roles nothing references.
-- If those accounts ever produced an export, delete its export_file rows first.
delete from erph.school_member where user_id in
  (select id from erph.user where username in ('ppd.petaling', 'jpn.selangor'));
delete from erph.user where username in ('ppd.petaling', 'jpn.selangor');

-- ── 8 · the Administrator account ──────────────────────────────────────────
-- From db/seed.sql; change the password hash before any real deployment.
insert into erph.user (username, password_hash, full_name, email, role, is_active)
values ('pentadbir.sk',
        'scrypt$16384$8$1$sBZJbXJZGtDoXYVtM_r_MA$_Q_vvOJhHbPEbvKonOnd-ktpbXbn0axcvfihN6Gvw3QbzfzfEWoXvyhHi8rFcWaxKqNtYn9iUxIlQYOTgGmVGg',
        'Pentadbir eRPH', 'pentadbir@sk0000.local', 'pentadbir', true)
on conflict do nothing;

insert into erph.school_member (school_id, user_id, role)
select s.id, u.id, 'pentadbir' from erph.school s, erph.user u
where s.kod_sekolah = 'SK0000' and u.username = 'pentadbir.sk'
on conflict do nothing;
"""

OUT.write_text(body, encoding="utf-8")
print(f"{alter_a.relative_to(root)} written (6 statements, run one at a time)")
print(f"{OUT.relative_to(root)} written ({len(body)} chars)")

# ── 002: the administrator's set-up console ─────────────────────────────────
# A separate file rather than folded into 001b, because 001 may already have
# been run against a live database: re-running a regenerated 001b would be
# asking someone to apply an unknown mix of old and new. This one is safe to run
# on its own, and idempotent — every statement is `if not exists`, `if exists`
# or `create or replace`.
OUT2 = DIR / "002_admin_console.sql"

drops = "\n".join(f"drop function if exists erph.{sig};" for sig in CHANGED_SHAPE)
fns = "\n".join("\n" + function(n) + "\n" for n in ADMIN_FUNCTIONS)

body2 = f"""-- ============================================================================
-- eRPH · MIGRATION 002 — the administrator's set-up console
-- ============================================================================
-- Run AFTER 001a/001b. Safe to run more than once.
--
-- Adds the accounts, classes, subjects and session management behind
-- /pentadbiran, and the index that makes "create account" actually safe.
--
-- Two existing functions are dropped first rather than replaced: one changed
-- its return type (which `create or replace` refuses outright) and one gained a
-- parameter (which it would otherwise leave behind as an overload — the old
-- four-argument form would keep silently ignoring the new session argument).
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ── 1 · shapes that changed ────────────────────────────────────────────────
{drops}

-- ── 2 · admin set-up functions ─────────────────────────────────────────────
{fns}
-- ── 3 · username uniqueness ────────────────────────────────────────────────
-- Login matches case-insensitively and /api/admin/accounts creates accounts
-- from a form, so uniqueness has to hold on the lowercased name: `Admin` and
-- `admin` are the same person. Without it two accounts can share a username and
-- login picks one arbitrarily.
--
-- If this statement fails with "duplicate key", find the offenders first:
--
--   select lower(username), count(*) from erph.user
--    group by 1 having count(*) > 1;
--
-- resolve them, then re-run.
create unique index if not exists user_username_uniq on erph.user (lower(username));
"""

OUT2.write_text(body2, encoding="utf-8")
print(f"{OUT2.relative_to(root)} written ({len(body2)} chars)")


def buckets() -> str:
    """The `insert into storage.buckets … ;` statement, verbatim."""
    m = re.search(r"insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;", sql)
    if not m:
        raise SystemExit("storage bucket insert not found in db/schema.sql")
    return m.group(0)


# ── 003: the school's own identity ───────────────────────────────────────────
# Adds the columns the administrator edits, the function that writes them, the
# public bucket the crest lives in, and the two policies that stop staff reading
# the Administrator's account. Idempotent: `if not exists`, `drop … if exists`
# then `create`, and `on conflict do nothing`.
OUT3 = DIR / "003_school_identity.sql"

SCHOOL_POLICIES = ["profile_read", "member_read", "storage_read_school_logo"]

# `admin_set_school` gained a parameter when the school code became editable.
# `create or replace` does not replace on a *signature change* — it silently
# creates a second function — so the six-argument form has to go first,
# otherwise a database that already ran the earlier 003 keeps both and the RPC
# is resolved by arity rather than by intent. No-op if it was never created.
OLD_SET_SCHOOL = "drop function if exists erph.admin_set_school(uuid, text, text, text, text, text);"

body3 = f"""-- ============================================================================
-- eRPH · MIGRATION 003 — the school's own identity
-- ============================================================================
-- Run AFTER 001a/001b and 002. Safe to run more than once.
--
--   · erph.school gains `motto` and `logo_url` — what the administrator edits
--     from /pentadbiran and what the login screen, sidebar and printed RPH
--     then show everywhere.
--   · erph.admin_set_school writes those *and* `kod_sekolah`, which became
--     editable in the same release (see the comment on the function).
--   · the public `school-assets` bucket the crest is served from.
--   · profile_read / member_read stop a GPK or Guru Besar reading the
--     Administrator's account through `shares_school_with` / `is_staff`.
--
-- Policies are dropped first: `create policy` has no `if exists`, and these
-- two would otherwise collide with the copies already installed.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ── 1 · columns ─────────────────────────────────────────────────────────────
alter table erph.school add column if not exists motto text;
alter table erph.school add column if not exists logo_url text;

-- ── 2 · the bucket the crest is served from ─────────────────────────────────
-- Public: the crest renders on the login screen before a session exists.
{buckets()}

-- ── 3 · policies ────────────────────────────────────────────────────────────
{chr(10).join(f"drop policy if exists {n} on " + ("storage.objects" if n.startswith("storage_") else "erph." + ("user" if n == "profile_read" else "school_member")) + ";" for n in SCHOOL_POLICIES)}

{chr(10).join(policy(n) + chr(10) for n in SCHOOL_POLICIES)}
-- ── 4 · the administrator's editor ─────────────────────────────────────────
{OLD_SET_SCHOOL}
{function("admin_set_school")}
"""

OUT3.write_text(body3, encoding="utf-8")
print(f"{OUT3.relative_to(root)} written ({len(body3)} chars)")


def table_ddl(name: str) -> str:
    m = re.search(rf"create table erph\.{name} \([\s\S]*?\n\);", sql)
    if not m:
        raise SystemExit(f"table erph.{name} not found in db/schema.sql")
    return m.group(0)


def index_ddl(name: str) -> str:
    found = [m.group(0) for m in re.finditer(rf"create index \w+ on erph\.{name}[\s\S]*?;", sql)]
    if not found:
        raise SystemExit(f"no index on erph.{name} found in db/schema.sql")
    # Migrations re-run over tables that already carry these indexes, so
    # `if not exists` is added rather than copied verbatim from a fresh-install
    # schema where it is not needed.
    return "\n".join(ln.replace("create index ", "create index if not exists ", 1) for ln in found)


# ── 004: supervision and the signed, single-stage review ─────────────────────
# Three changes that only make sense together:
#
#   · a teacher belongs to a GPK (`school_member.supervisor_id`), and scope is
#     a relationship rather than a role;
#   · the GPK → Guru Besar `forwarded` hop is gone, so both reviewers act on
#     `submitted` and either approve or return;
#   · approval carries a signature, and only the server may append one.
OUT4 = DIR / "004_supervision_and_signing.sql"

SCOPE_POLICIES = ["rph_reviewer_read", "rph_revision_read", "rph_review_read"]
SCOPE_TARGET = {
    "rph_reviewer_read": "rph_document",
    "rph_revision_read": "rph_revision",
    "rph_review_read": "rph_review",
}
SCOPE_FUNCS = ["supervises", "may_supervise", "admin_set_supervisor"]
REVIEW_FUNCS = ["sahkan_rph", "hantar_balik_rph"]

body4 = f"""-- ============================================================================
-- eRPH · MIGRATION 004 — supervision scope and the signed single-stage review
-- ============================================================================
-- Run AFTER 001a/001b/002/003. Safe to run more than once.
--
--   · erph.school_member gains `supervisor_id`, so a GPK's scope is the set of
--     teachers who point at them rather than every plan in the school.
--   · erph.semak_rph and erph.lulus_rph are retired. There is no longer a
--     GPK → Guru Besar hop: a GPK approves directly, and a Guru Besar can do
--     everything a GPK can on any teacher's plan.
--   · erph.rph_signature is new, and only the server can write to it —
--     approval is impossible without a signature already on file.
--
-- `forwarded` stays in the rph_status enum: Postgres cannot drop a value, and
-- nothing produces it any more.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ── 1 · supervision column ──────────────────────────────────────────────────
alter table erph.school_member
  add column if not exists supervisor_id uuid references erph.user(id) on delete set null;

{index_ddl("school_member")}

-- ── 2 · retire the two-stage functions ──────────────────────────────────────
-- Dropped rather than replaced: a differently-shaped `create or replace` would
-- leave the old arity behind as a silent overload.
{chr(10).join(f"drop function if exists erph.{sig};" for sig in RETIRED)}
-- Return type gained four columns, and Postgres refuses to change one in place.
drop function if exists erph.admin_list_members(uuid);

-- ── 3 · the new functions ───────────────────────────────────────────────────
-- Before any policy that mentions them: `create policy` resolves the function
-- references in its expression at creation time, so a policy written above
-- would fail with "function may_supervise does not exist".
{chr(10).join(function(n) + chr(10) for n in SCOPE_FUNCS)}
{chr(10).join(function(n) + chr(10) for n in LATE_FUNCTIONS)}
{chr(10).join(function(n) + chr(10) for n in REVIEW_FUNCS)}
-- ── 4 · the signature store ─────────────────────────────────────────────────
-- Deliberately has no INSERT or UPDATE policy. PostgreSQL cannot verify an
-- ECDSA signature (pgcrypto: "No support for signing"), so the database cannot
-- check one; instead it restricts who may append, and sahkan_rph refuses to
-- approve a plan without a matching row. See the comment on the table.
{table_ddl("rph_signature").replace("create table ", "create table if not exists ", 1)}

{index_ddl("rph_signature")}
alter table erph.rph_signature enable row level security;
drop policy if exists rph_signature_read on erph.rph_signature;
{policy("rph_signature_read")}

-- ── 5 · scope-limited read policies ─────────────────────────────────────────
{chr(10).join(f"drop policy if exists {n} on erph.{SCOPE_TARGET[n]};" for n in SCOPE_POLICIES)}

{chr(10).join(policy(n) for n in SCOPE_POLICIES)}"""

OUT4.write_text(body4, encoding="utf-8")
print(f"{OUT4.relative_to(root)} written ({len(body4)} chars)")

# ── 005: per-teacher monitoring, scoped like everything else ────────────────
OUT5 = DIR / "005_pantau_teachers.sql"

body5 = f"""-- ============================================================================
-- eRPH · MIGRATION 005 — per-teacher monitoring for /sekolah
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004. Safe to run more than once.
--
-- The per-teacher table was hard-coded fixtures; this makes it real, and
-- scoped the same way as everything else.
--
-- Scope is applied *inside* the function through erph.may_supervise rather
-- than in the handler that calls it. SECURITY DEFINER means the caller's RLS
-- is not consulted at all, so a handler that fetched the roster and filtered
-- it in JavaScript would be one careless edit away from showing a GPK their
-- whole school — and unlike a missing filter in a policy, nothing downstream
-- would catch it.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ── 1 · the function ────────────────────────────────────────────────────────
{function("pantau_teachers")}
"""

OUT5.write_text(body5, encoding="utf-8")
print(f"{OUT5.relative_to(root)} written ({len(body5)} chars)")

# ── 006: sign in with a KPM Google account ──────────────────────────────────
OUT6 = DIR / "006_google_identity.sql"

body6 = f"""-- ============================================================================
-- eRPH · MIGRATION 006 — sign in with a KPM Google account
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005. Safe to run more than once.
--
-- Two columns that bind an existing account to a Google identity. Nothing is
-- populated here: linking happens on a teacher's first successful Google
-- sign-in, and only for an account the pentadbir has already created. There is
-- deliberately no auto-provision — every teacher in the ministry has an
-- @moe-dl.edu.my address, so "create one if none exists" would let any of them
-- walk into this school's records by typing its URL.
--
-- Password login is unaffected. It remains the only route in local mode, and
-- the only route for anyone without an MOE account.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ── 1 · columns ─────────────────────────────────────────────────────────────
alter table erph.user add column if not exists google_sub text;
alter table erph.user add column if not exists google_email text;

-- A named constraint rather than a column-level `unique`, because the column
-- form would name it `user_google_sub_key` and dropping or replacing it later
-- would mean guessing what Postgres decided to call it.
alter table erph.user drop constraint if exists user_google_sub_uniq;
alter table erph.user add constraint user_google_sub_uniq unique (google_sub);
"""

OUT6.write_text(body6, encoding="utf-8")
print(f"{OUT6.relative_to(root)} written ({len(body6)} chars)")

# ── 007: the school's own RPH template ──────────────────────────────────────
OUT7 = DIR / "007_school_template.sql"

body7 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 007 — the school's own RPH template
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005/006. Safe to run more than once.
--
-- Three things, all forced by matching the form the school actually submits:
--
--   1. `slot_time_end`. The printed form has Masa Mula *and* Masa Tamat, and a
--      plan that carries only a start time leaves the printed page to invent an
--      end time — which is how a five-hour lesson reaches an approved document.
--      Defaulted to 12:40, the school's own end time, so every existing plan
--      prints a plausible pair rather than a dash.
--
--   2. `rph_completeness` redefined. Kriteria Kejayaan replaces the old
--      Intervensi/EMK checkpoint: the printed form has a Kriteria Kejayaan row
--      and no Intervensi or EMK row, so scoring those meant a plan could read
--      100% while missing a field the district will look for — or read less
--      than 100% because a teacher left blank the content nobody prints.
--
--      Also: an activity now scores if *any* element carries a `nama`, not if
--      the first does. An activity list whose first row is a blank separator
--      still has activities in it, and a gate that cannot be satisfied by
--      filling the form correctly is a bug, not a check.
--
--   3. `sync_rph` widened to carry the new column. Without it, a plan edited
--      offline and synced back would keep whatever end time the server had.
--
-- The payload reshape itself (aktiviti → names, tajuk, kriteria_kejayaan) is
-- client-side and needs no DDL: zod strips what it does not know, so documents
-- written before this change stay readable, they simply carry less.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the column ──────────────────────────────────────────────────────────
alter table erph.rph_document
  add column if not exists slot_time_end time not null default '12:40';

-- ▸ 2 ▸ the completeness rules ──────────────────────────────────────────────
{function("rph_completeness")}

-- ▸ 3 ▸ the sync function that carries the column ───────────────────────────
{function("sync_rph")}
"""

OUT7.write_text(body7, encoding="utf-8")
print(f"{OUT7.relative_to(root)} written ({len(body7)} chars)")

# ---------------------------------------------------------------------------
# 008: reminders a supervisor can actually send
# ---------------------------------------------------------------------------
OUT8 = DIR / "008_reminders.sql"

body8 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 008 — reminders a supervisor can actually send
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005/006/007. Safe to run more than once.
--
-- Both "Hantar peringatan" buttons printed a toast saying reminders had been
-- sent and sent nothing. The notification table had a writer for review
-- decisions and none for reminders, so a Guru Besar pressing the button was
-- told their staff had been reminded while the staff heard nothing.
--
-- `erph.remind_teachers` writes the rows. Scope is applied inside the
-- function through `erph.may_supervise` rather than in the handler, exactly
-- as `pantau_teachers` filters its result: SECURITY DEFINER means the
-- caller's RLS is not consulted at all, so a handler that resolved the
-- roster in JavaScript and posted ids would be one careless edit from letting
-- a GPK nudge every teacher in the district.
--
-- One nudge per teacher per week. Without that, tapping the button twice
-- fills a teacher's bell with identical rows, which is how a notification
-- system trains people to ignore it.
--
-- `reminder` already exists in erph.notification_type; no enum change.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the function ───────────────────────────────────────────────────────
{function("remind_teachers")}
"""

OUT8.write_text(body8, encoding="utf-8")
print(f"{OUT8.relative_to(root)} written ({len(body8)} chars)")

# ---------------------------------------------------------------------------
# 009: real weekly figures for /sekolah
# ---------------------------------------------------------------------------
OUT9 = DIR / "009_week_history.sql"

body9 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 009 — real weekly figures for /sekolah
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005/006/007/008. Safe to run more than once.
--
-- /sekolah's charts were bundled constants presented as the school's own: the
-- six-week trend, the sparkline and the average completion time never varied
-- by school, week or caller. `school_week_stats` answers "how is this week
-- doing"; nothing answered "how has it been going", so the cards made the
-- second question up.
--
-- `school_week_history` counts it instead. Same permission shape as the
-- single-week function — counts and a percentage, never a name — so a Guru
-- Biasa still cannot learn who is behind a figure.
--
-- `expected` is active membership *now*, not per week: historical membership
-- is not recorded, so a teacher who left in week 3 still counts in week 1's
-- denominator. Stated rather than faked, and it only ever makes an older week
-- look slightly worse than it was.
--
-- `avg_minutes` covers only plans that have been decided. Averaging over the
-- undecided would be timing a clock that has not stopped.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the function ───────────────────────────────────────────────────────
{function("school_week_history")}
"""

OUT9.write_text(body9, encoding="utf-8")
print(f"{OUT9.relative_to(root)} written ({len(body9)} chars)")

# ---------------------------------------------------------------------------
# 010: the roster follows the same window as the cards
# ---------------------------------------------------------------------------
OUT10 = DIR / "010_pantau_range.sql"

body10 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 010 — the roster follows the same window as the cards
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005/006/007/008/009. Safe to run more than
-- once.
--
-- /sekolah's filter widened the window its cards describe, and the roster
-- underneath still counted a single week — so a supervisor choosing
-- "Sepanjang sesi" read a session total beside a table that disagreed with
-- it. The table and the cards now come from the same weeks by construction:
-- both take p_first_week/p_last_week.
--
-- Signature changes from p_week to the pair. The only caller is
-- /api/pantau/teachers, updated with it.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the function ───────────────────────────────────────────────────────
{function("pantau_teachers")}
"""

# `create or replace` treats a changed parameter list as a *new* function,
# so without this the old single-week version stays callable beside the
# new one. Every other signature change in this repo drops first.
body10 = body10.replace(
    "create or replace function erph.pantau_teachers",
    "drop function if exists erph.pantau_teachers(uuid, text, smallint);\n"
    "\ncreate or replace function erph.pantau_teachers",
    1,
)

OUT10.write_text(body10, encoding="utf-8")
print(f"{OUT10.relative_to(root)} written ({len(body10)} chars)")

# ---------------------------------------------------------------------------
# 011: the fix rate, after a return
# ---------------------------------------------------------------------------
OUT11 = DIR / "011_fix_rate.sql"

body11 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 011 — the fix rate, after a return
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005/006/007/008/009/010. Safe to run more
-- than once.
--
-- pantau_teachers gains returned_total and fixed_total: of the plans a
-- teacher has had sent back, and how many are approved now.
--
-- The pair exists because neither number means much alone. A count of who is
-- *currently* returned cannot separate a teacher who acts on feedback from
-- one who ignores it — a teacher who fixes everything and one who never does
-- look identical the moment the first is caught up. Read from rph_review
-- rather than the document, because the document carries only the latest
-- decision, and the history of a plan that was returned and then approved is
-- exactly what makes it "fixed".
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the function ───────────────────────────────────────────────────────
{function("pantau_teachers")}
"""

# Both signatures. Postgres refuses to change a return type in place
# (42P13), so the function being widened has to go first — and the
# single-week overload is the one migration 010 left behind. Dropping
# both makes this safe whether or not 010 went on ahead of it.
body11 = body11.replace(
    "create or replace function erph.pantau_teachers",
    "drop function if exists erph.pantau_teachers(uuid, text, smallint, smallint);\n"
    "drop function if exists erph.pantau_teachers(uuid, text, smallint);\n"
    "\ncreate or replace function erph.pantau_teachers",
    1,
)

OUT11.write_text(body11, encoding="utf-8")
print(f"{OUT11.relative_to(root)} written ({len(body11)} chars)")

# ---------------------------------------------------------------------------
# 012: the office a person holds, printed on the cover sheet
# ---------------------------------------------------------------------------
OUT12 = DIR / "012_jawatan.sql"

body12 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 012 — the office a person holds, printed on the cover
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005/006/007/008/009/010/011. Safe to run more
-- than once.
--
-- The JAWATAN row of the weekly cover sheet read `school_member.title`, a
-- free-text column no code path ever wrote — so every cover printed "—"
-- beneath a signature the school had actually made, on a sheet whose whole
-- point is that a district officer can tell who signed it and as what.
--
-- `erph.jawatan` is the office the school sets, and it is deliberately not
-- derived from `erph.member_role`: three different Penolong Kanan offices
-- live under the single role 'gpk', so the role cannot say which one this
-- person holds. NULL means nobody has said, and prints as "—".
--
-- The backfill covers only what the role already states outright. 'gpk' does
-- not name an office, so it stays NULL rather than being given one — a cover
-- sheet that invented an office the school never gave would be exactly the
-- failure this replaces.
--
-- Two function shapes change, and both need a drop first:
--
--   · `admin_list_members` gains a column, i.e. a new *return type*, which
--     Postgres refuses to change in place (42P13);
--   · `admin_create_member` gains a parameter, which Postgres treats as an
--     entirely different function — without the drop the old arity lingers
--     beside the new one and a call that omits the jawatan keeps resolving
--     to the version that cannot set it.
--
-- `admin_set_member` now writes `erph.user.role` too. The route guard reads
-- that column on every request while the function only ever wrote
-- `school_member.role`, so "peranan dikemas kini" was reporting half a change
-- in both directions: a promotion that never reached the review screens, a
-- demotion that never reached the session.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the enum and the column ─────────────────────────────────────────────
-- A database built by running 001b first already has both — 001b creates them
-- so that 002 and 004 can name the type in a signature — and both statements
-- below then change nothing. They are here for a database that ran the
-- original 001b, which had no idea this column was coming.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'erph' and t.typname = 'jawatan'
  ) then
    create type erph.jawatan as enum (
      'guru_biasa', 'pk_pentadbiran', 'pk_hem', 'pk_kokum', 'guru_besar'
    );
  end if;
end $$;

alter table erph.user add column if not exists jawatan erph.jawatan;

-- ▸ 2 ▸ the backfill, where the role already says it ────────────────────────
update erph.user set jawatan = 'guru_biasa'
 where role = 'guru_biasa' and jawatan is null;

update erph.user set jawatan = 'guru_besar'
 where role = 'guru_besar' and jawatan is null;

-- ▸ 3 ▸ the functions ───────────────────────────────────────────────────────
drop function if exists erph.admin_list_members(uuid);
drop function if exists erph.admin_create_member(uuid, text, text, erph.member_role, text, text);

{function("jawatan_for")}

{function("admin_list_members")}

{function("admin_create_member")}

{function("admin_set_member")}

{function("admin_set_jawatan")}
"""

OUT12.write_text(body12, encoding="utf-8")
print(f"{OUT12.relative_to(root)} written ({len(body12)} chars)")

# ---------------------------------------------------------------------------
# 013: the denominator behind "pematuhan sekolah"
# ---------------------------------------------------------------------------
OUT13 = DIR / "013_week_expectation.sql"

body13 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 013 — the denominator behind "pematuhan sekolah"
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005/006/007/008/009/010/011/012. Safe to run
-- more than once.
--
-- The compliance percentage divided approved *plans* by the number of
-- *teachers*. A school that runs Monday to Friday asks each teacher for five
-- RPH, so a teacher who finished their week put the school at 500%, and two
-- teachers with six approved plans between them read as 300% — a figure
-- nobody at the school recognised, because it was measuring the wrong thing.
--
-- The denominator is now teachers × the school's own `rph_per_week` (five by
-- default, editable on /pentadbiran), and both statistics functions return
-- the headcount as well so the roster beside the chart still has it. The
-- percentage is capped at 100: submitting more than the week requires has
-- met the requirement, not exceeded it, and the counts beside it still say
-- exactly how many plans were approved.
--
-- Both functions change their *return type* (a column each), which Postgres
-- refuses to change in place (42P13) — so both are dropped first, along with
-- `admin_set_setting`, which gained a parameter and would otherwise leave the
-- old arity callable beside the new one. `v_school_compliance` reads the
-- first of them, so it is dropped with them and rebuilt at the end.
--
-- `school_setting.rph_per_week` is created here for a database that ran the
-- original 001b; a fresh chain already has it from 001b, and both statements
-- below then change nothing.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the school's own weekly rule ────────────────────────────────────────
alter table erph.school_setting
  add column if not exists rph_per_week smallint not null default 5;

alter table erph.school_setting drop constraint if exists school_setting_rph_per_week_check;
alter table erph.school_setting add constraint school_setting_rph_per_week_check
  check (rph_per_week between 1 and 7);

-- ▸ 2 ▸ shapes that changed ─────────────────────────────────────────────────
-- The view is dropped first and rebuilt at the end: it reads
-- `school_week_stats`, and Postgres refuses to drop a function anything
-- depends on. Recreated here rather than left to the next migration so that
-- this file still leaves the schema complete on its own.
drop view if exists erph.v_school_compliance;

drop function if exists erph.school_week_stats(uuid, text, smallint);
drop function if exists erph.school_week_history(uuid, text, smallint, smallint);
drop function if exists erph.admin_set_setting(uuid, smallint, time, boolean, text);

-- ▸ 3 ▸ the functions ───────────────────────────────────────────────────────
{function("school_week_stats")}

{function("school_week_history")}

{function("admin_set_setting")}

-- ▸ 4 ▸ the view, back ──────────────────────────────────────────────────────
{view("v_school_compliance")}
"""

OUT13.write_text(body13, encoding="utf-8")
print(f"{OUT13.relative_to(root)} written ({len(body13)} chars)")

# ---------------------------------------------------------------------------
# 014: the two places the new percentage could still lie
# ---------------------------------------------------------------------------
OUT14 = DIR / "014_compliance_truth.sql"

body14 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 014 — the two places the new percentage could still lie
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005/006/007/008/009/010/011/012/013. Safe to
-- run more than once.
--
-- Three leftovers from the fix, found by reading the whole surface again:
--
--   · `least()` ignores NULL arguments, so `least(100, NULL)` is 100 — not
--     NULL, as the SQL standard says. A school with no active Guru Biasa has
--     no denominator, and was reporting full compliance for it. Both
--     statistics functions now return NULL for that week, which the UI
--     renders as "—": not scored, rather than scored perfectly.
--
--   · `v_school_compliance` still computed approved plans divided by the
--     teacher headcount — the definition the percentage was fixed *from*, and
--     uncapped, so it could answer 300%. Nothing reads the view today, but it
--     is exposed to the API roles and a second source that disagrees with the
--     first is one forgotten import away from being the one that ships. It
--     now asks `school_week_stats`, so the two cannot drift apart.
--
--   · `admin_set_member` wrote only `school_member.role` until 012, while the
--     route guard reads `erph.user.role` on every request. An account whose
--     role was changed through /pentadbiran before then therefore has two
--     roles, and the one the guard held was the stale one. The membership is
--     what the console wrote, so it wins — for a user with exactly one
--     school. Anyone in several is left alone rather than having one picked.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the two statistics functions ────────────────────────────────────────
{function("school_week_stats")}

{function("school_week_history")}

-- ▸ 2 ▸ the view, rebuilt on the same definition ───────────────────────────
drop view if exists erph.v_school_compliance;

{view("v_school_compliance")}

-- ▸ 3 ▸ the role the guard reads ───────────────────────────────────────────
update erph.user u
   set role = m.role
  from erph.school_member m
 where m.user_id = u.id
   and m.is_active
   and m.role <> u.role
   and not exists (
         select 1 from erph.school_member other
          where other.user_id = u.id and other.is_active
            and other.school_id <> m.school_id);
"""

OUT14.write_text(body14, encoding="utf-8")
print(f"{OUT14.relative_to(root)} written ({len(body14)} chars)")

# ---------------------------------------------------------------------------
# 015: edit what could only be created
# ---------------------------------------------------------------------------
OUT15 = DIR / "015_edit_existing.sql"

body15 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 015 — edit what could only be created
-- ============================================================================
-- Run AFTER 001a/001b/002/003/004/005/006/007/008/009/010/011/012/013/014.
-- Safe to run more than once.
--
-- Two things a school could create and never correct:
--
--   · an account's name and email — the name printed on every RPH that person
--     writes, and the address Google sign-in links to on a first visit. A typo
--     meant deleting the account and importing it again, taking their plans
--     with them;
--   · a subject's name and curriculum — only Matikan/Hidupkan existed, so a
--     misnamed subject had to be hidden and a second one created beside it.
--
-- Both keep the thing that cannot be changed: the username (the sign-in
-- identity devices are already signed in on) and the subject code (a foreign
-- key on every plan, DSKP standard and teaching assignment).
--
-- New functions, so there is nothing to drop: `create or replace` is enough.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the two edits ────────────────────────────────────────────────────────
{function("admin_set_profile")}

{function("admin_edit_subject")}
"""

OUT15.write_text(body15, encoding="utf-8")
print(f"{OUT15.relative_to(root)} written ({len(body15)} chars)")

# ---------------------------------------------------------------------------
# 016: one model of who may do what
# ---------------------------------------------------------------------------
# Three places where the TypeScript guard and the SQL layer disagreed about
# the same person, or where the SQL layer said nothing at all.
OUT16 = DIR / "016_authorization_truth.sql"

body16 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 016 — one model of who may do what
-- ============================================================================
-- Run AFTER 001a/001b/002/…/015. Safe to run more than once.
--
-- Three places where the server said one thing and the SQL layer another:
--
--   · `admin_set_member` set the *role* on both rows that hold it but the
--     *active flag* on only one. Every policy reads `school_member.is_active`,
--     so a dismissed teacher stayed an active member with their old office:
--     still in the monitoring roster, still inside `has_role` in the review
--     RPCs, still reminded. The route guard read `erph.user.is_active` and
--     did refuse them — so the two models disagreed about the same person,
--     and the SQL one was the wrong one.
--
--   · `school_week_history` had no membership check at all, while the
--     single-week function beside it did. It is SECURITY DEFINER, so the
--     caller's own RLS is never consulted, and the blanket grant on the
--     schema's routines let anyone holding the publishable key read any
--     school's year: headcount, submissions, approvals, compliance and how
--     long the school takes to review.
--
--   · `sync_rph` let the owner rewrite a plan that was already sitting in a
--     reviewer's queue — and turned an unrecognised status into 'draft',
--     which let a client withdraw its own plan from review without going
--     through `submit_rph` at all. The editor already locks a submitted
--     plan; the server now says the same.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the membership write ──────────────────────────────────────────────
{function("admin_set_member")}

-- ▸ 2 ▸ the weekly history ─────────────────────────────────────────────────
-- Dropped first: the body changes from SQL to plpgsql so the refusal can be
-- the same exception its sibling raises. `create or replace` is not worth
-- trusting with a language change.
drop function if exists erph.school_week_history(uuid, text, smallint, smallint);

{function("school_week_history")}

-- ▸ 3 ▸ the sync path ──────────────────────────────────────────────────────
{function("sync_rph")}
"""

OUT16.write_text(body16, encoding="utf-8")
print(f"{OUT16.relative_to(root)} written ({len(body16)} chars)")

# ---------------------------------------------------------------------------
# 017: the school's own rules, and one bad op no longer losing a batch
# ---------------------------------------------------------------------------
OUT17 = DIR / "017_school_rules.sql"

body17 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 017 — the school's own rules
-- ============================================================================
-- Run AFTER 001a/001b/002/…/016. Safe to run more than once.
--
-- Four things:
--
--   · `school_setting.require_complete` was written by the administrator and
--     read by *nothing*: the submission gate was hard-coded to 100%, so the
--     switch on /pentadbiran → Sesi & tarikh akhir did nothing at all. A
--     setting that looks like a control and is not one is worse than no
--     setting. It now decides whether an incomplete plan may be submitted.
--
--   · `sahkan_rph` records a grade, and the grade is a factual claim:
--     Lampiran 7 grades a plan 1 = lengkap, 0 = tidak lengkap. Recording 1
--     for a plan that is missing sections puts a false statement into a
--     statutory record — and the school's compliance figures are built from
--     the grade, so a false grade is a false figure. An approval now needs
--     the same completeness the school asked for at submission.
--
--   · `sync_rph` applied a batch as one transaction, so one malformed op
--     aborted the other twenty-four and took the teacher's work with it. Each
--     op is now applied inside its own block: a failure is reported for that
--     op and the rest go through. The block is a subtransaction, so the claim
--     on a failed op's id is rolled back with it — the op id is still free and
--     the client can retry the very same op rather than losing the edit.
--
--   · `erph.user` had one UPDATE policy allowing any column of one's own row.
--     It was harmless only because the whole table is revoked from the API
--     roles at the end of the schema — a single statement, in a 2,300-line
--     file. The column grant below says which columns are writable, so a
--     lost revoke cannot let a teacher write their own role.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the submission and approval gates ──────────────────────────────────
{function("submit_rph")}

{function("sahkan_rph")}

-- ▸ 2 ▸ the sync path ──────────────────────────────────────────────────────
{function("sync_rph")}

-- ▸ 3 ▸ the columns a signed-in teacher may write on their own row ─────────
grant update (full_name, email) on erph.user to authenticated;
"""

OUT17.write_text(body17, encoding="utf-8")
print(f"{OUT17.relative_to(root)} written ({len(body17)} chars)")

# ---------------------------------------------------------------------------
# 018: the school's figures are a supervisor's question
# ---------------------------------------------------------------------------
OUT18 = DIR / "018_school_figures_for_supervisors.sql"

body18 = f"""-- ============================================================================
-- eRPH ▸ MIGRATION 018 — the school's figures are a supervisor's question
-- ============================================================================
-- Run AFTER 001a/001b/002/…/017. Safe to run more than once.
--
-- `school_week_stats` and `school_week_history` accepted any member of the
-- school. That was deliberate — they return counts and a percentage and never
-- a name — and it was the wrong question. A Guru Biasa's dashboard is about
-- their own week: four cards and nothing about anyone else's. A school's
-- compliance percentage beside them is an answer to a question they are no
-- more able to act on than a colleague's roster, which `/api/pantau/teachers`
-- has always refused.
--
-- So the dashboard hid the card while the endpoint served it, and both had to
-- be told the same thing. `/api/stats` asks for `pantau` now, and these two
-- check for a supervisor — or the school's own Administrator, who already
-- answers for the school's figures on `/utama` and whose view
-- (`v_school_compliance`) is `security_invoker`, so leaving them out would
-- make a table they hold error rather than quietly show less.
--
-- Generated by scripts/gen-migration.py from db/schema.sql:
--
--   python scripts/gen-migration.py
--
-- ▸ 1 ▸ the two statistics functions ─────────────────────────────────────
{function("school_week_stats")}

{function("school_week_history")}
"""

OUT18.write_text(body18, encoding="utf-8")
print(f"{OUT18.relative_to(root)} written ({len(body18)} chars)")
