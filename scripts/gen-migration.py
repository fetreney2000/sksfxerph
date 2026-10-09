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
    "semak_rph",
    "lulus_rph",
    "school_week_stats",
    "admin_list_members",
    "admin_set_member",
    "admin_set_setting",
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

# DDL for migrations beyond 001, generated from the same source so nothing is
# ever hand-copied out of schema.sql.
ADMIN_FUNCTIONS = [
    "admin_list_members",
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
POLICIES = [
    ("rph_reviewer_read", "erph.rph_document"),
    ("rph_revision_read", "erph.rph_revision"),
    ("rph_review_read", "erph.rph_review"),
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
-- Generated by scripts/gen-migration.py from db/schema.sql, so the definitions
-- below cannot drift from the schema they are migrating towards.
--
--   python scripts/gen-migration.py
-- ============================================================================

-- ── 1 · column defaults ────────────────────────────────────────────────────
alter table erph.user         alter column role set default 'guru_biasa';
alter table erph.school_member alter column role set default 'guru_biasa';

-- ── 2 · the single-stage reviewer is gone ──────────────────────────────────
drop function if exists erph.review_rph(uuid, smallint, text);

-- ── 3 · helpers, RPCs and the new admin set-up ─────────────────────────────
-- Shapes that changed: these cannot be `create or replace`d over.
{chr(10).join(f"drop function if exists erph.{sig};" for sig in CHANGED_SHAPE)}

{chr(10).join(chr(10) + function(n) + chr(10) for n in FUNCTIONS)}
-- ── 4 · policies embedding a role literal ─────────────────────────────────
drop policy if exists rph_reviewer_read on erph.rph_document;
drop policy if exists rph_revision_read on erph.rph_revision;
drop policy if exists rph_review_read on erph.rph_review;
drop policy if exists export_read on erph.export_file;
drop policy if exists audit_admin_read on erph.audit_log;
drop policy if exists storage_read on storage.objects;

{chr(10).join(policy(n) + chr(10) for n, _ in POLICIES)}
-- ── 5 · views (keyed on status, so a GPK's grade-1 is not an approval) ─────
drop view if exists erph.v_teacher_week;
drop view if exists erph.v_school_compliance;

{chr(10).join(view(n) + chr(10) for n in VIEWS)}
-- ── 6 · accounts ───────────────────────────────────────────────────────────
-- The district/state roles are gone from the app. Postgres cannot drop an enum
-- value at all, so deleting the rows is what keeps the data honest — leaving
-- them would mean two roles nothing references.
-- If those accounts ever produced an export, delete its export_file rows first.
delete from erph.school_member where user_id in
  (select id from erph.user where username in ('ppd.petaling', 'jpn.selangor'));
delete from erph.user where username in ('ppd.petaling', 'jpn.selangor');

-- ── 7 · the Administrator account ──────────────────────────────────────────
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
