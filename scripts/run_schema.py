"""Execute AND verify db/schema.sql against a real PostgreSQL.

Why this exists: `db/validate.py` proves the SQL *parses*; only execution
proves it *resolves*. Two rounds of static validation still shipped a schema
that Supabase rejected at runtime (`type "member_role" does not exist`), so
this is now the authoritative gate.

Covers three layers:

  1. DDL execution — statement by statement, with the source line number of
     any failure (Supabase stops at the first error; here we see all of them).
  2. Object inventory — tables/enums/policies/functions/indexes actually exist
     with the expected names and, for enums, the expected *values* (a value
     that silently became 'erph.school' passes parsing but breaks the app).
  3. Behavioural smoke tests — inserts through the real tables, the
     completeness function, the review-state trigger, and the authorization
     guards (a NULL actor must be refused, not silently allowed).

    python scripts/run_schema.py

ERPH_DSN runs against an existing database instead of the throwaway cluster
that `pgserver` starts for us (no Docker needed).
"""
from __future__ import annotations

import os
import pathlib
import re
import sys
import tempfile

# A Windows console defaults to cp1252, which cannot encode the arrows this
# script prints. The resulting UnicodeEncodeError is caught by the behaviour
# tests and reported as a bogus "[FAIL] insert chain", so force UTF-8 output.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
SQL_FILE = ROOT / "db" / "schema.sql"

STUBS = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid
);
create or replace function storage.foldername(name text)
returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
"""

# pgserver's bundled PostgreSQL ships without contrib, so pg_trgm (and the one
# index that uses gin_trgm_ops) cannot be created locally. Supabase provides
# both, so these are skipped here and reported as environment-limited rather
# than counted as schema errors.
ENV_LIMITED = ["pg_trgm", "gin_trgm_ops"]


def split_statements(sql: str):
    stmts, start, i, in_dollar, in_comment, in_str = [], 0, 0, False, False, False
    while i < len(sql):
        ch = sql[i]
        if in_comment:
            if ch == "\n":
                in_comment = False
            i += 1
            continue
        if in_dollar:
            if sql.startswith("$$", i):
                in_dollar = False
                i += 2
                continue
            i += 1
            continue
        if in_str:
            if ch == "'":
                if sql.startswith("''", i):
                    i += 2
                    continue
                in_str = False
            i += 1
            continue
        if sql.startswith("$$", i):
            in_dollar = True
            i += 2
            continue
        if sql.startswith("--", i):
            in_comment = True
            i += 2
            continue
        if ch == "'":
            in_str = True
            i += 1
            continue
        if ch == ";":
            stmts.append((start, sql[start : i + 1]))
            start = i + 1
        i += 1
    tail = sql[start:]
    if tail.strip():
        stmts.append((start, tail))
    return stmts


class Runner:
    def __init__(self, conn):
        self.conn = conn

    def q(self, sql: str, params=None):
        with self.conn.cursor() as cur:
            if params is None:
                # No parameters → execute verbatim. Passing an empty tuple
                # would still make psycopg parse the SQL for `%s` placeholders,
                # which chokes on legitimate SQL like `like 'scrypt$%'`.
                cur.execute(sql)
            else:
                cur.execute(sql, params)
            if cur.description:
                return cur.fetchall()
            return []

    def one(self, sql: str, params=None):
        rows = self.q(sql, params)
        return rows[0] if rows else None


def connect():
    dsn = os.environ.get("ERPH_DSN")
    if dsn:
        print(f"target: {dsn.split('@')[-1]}")
        return psycopg.connect(dsn)

    import pgserver

    datadir = os.path.join(tempfile.gettempdir(), "erph_pg")
    pathlib.Path(datadir).mkdir(parents=True, exist_ok=True)
    server = pgserver.get_server(datadir)
    print(f"local postgres: {server.get_uri()}")
    # keep the server alive for the duration of this process
    global _SERVER
    _SERVER = server
    return psycopg.connect(server.get_uri())


import psycopg  # noqa: E402  (needed before connect() in the DSN branch)

_SERVER = None


def main() -> int:
    errors = 0
    env_limited = 0

    conn = connect()
    conn.autocommit = False
    r = Runner(conn)

    # ── fresh slate ────────────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("drop schema if exists erph cascade")
    conn.commit()
    r.q(STUBS)

    # ── which extensions does this server actually have? ───────────────────
    available = {row[0] for row in r.q("select name from pg_available_extensions")}

    sql = SQL_FILE.read_text(encoding="utf-8")
    stmts = split_statements(sql)
    print(f"{len(stmts)} statements · pg_trgm available: {'pg_trgm' in available}\n")

    # ── layer 1: execute every statement ───────────────────────────────────
    for offset, text in stmts:
        stripped = text.strip()
        if not stripped or all(
            ln.strip().startswith("--") or not ln.strip() for ln in text.split("\n")
        ):
            continue

        if "pg_trgm" in text and "pg_trgm" not in available:
            env_limited += 1
            continue
        if "gin_trgm_ops" in text and "pg_trgm" not in available:
            env_limited += 1
            continue

        line_no = sql[:offset].count("\n") + 1
        try:
            with conn.cursor() as cur:
                cur.execute(text)
        except Exception as e:  # noqa: BLE001
            errors += 1
            first = next(
                (
                    ln.strip()
                    for ln in text.split("\n")
                    if ln.strip() and not ln.strip().startswith("--")
                ),
                "",
            )
            print(f"DDL ERROR at line {line_no}: {str(e).splitlines()[0][:200]}")
            print(f"        {first[:140]}")
            conn.rollback()

    if env_limited:
        print(
            f"  (skipped {env_limited} statement(s) needing pg_trgm — "
            "unavailable in this server; Supabase provides it)"
        )

    if errors:
        print(f"\nRESULT: {errors} DDL error(s)")
        conn.close()
        return 1

    # ── layer 2: object inventory ──────────────────────────────────────────
    checks: list[tuple[str, bool, str]] = []

    def check(label, cond, detail=""):
        checks.append((label, bool(cond), detail))

    n_tables = r.one(
        "select count(*) from information_schema.tables where table_schema='erph' and table_type='BASE TABLE'"
    )[0]
    check("17 tables in erph", n_tables == 17, f"found {n_tables}")

    # policies live in TWO schemas: erph.* (tables) and storage.objects (buckets)
    n_policies = r.one("select count(*) from pg_policies where schemaname='erph'")[0]
    n_storage = r.one("select count(*) from pg_policies where schemaname='storage'")[0]
    check("24 policies on erph tables", n_policies == 24, f"found {n_policies}")
    check(
        "3 policies on storage.objects",
        n_storage == 3,
        f"found {n_storage} (only the ones this file creates)",
    )

    n_funcs = r.one(
        """select count(*) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'erph' and p.proname not in ('foldername')"""
    )[0]
    check("29 functions in erph", n_funcs == 29, f"found {n_funcs}")

    # NOTE: group into lists — a dict keyed by type name would keep only the
    # last label of each enum, which silently "passed" one value as three.
    rows = r.q(
        """select t.typname, e.enumlabel
           from pg_type t
           join pg_enum e on e.enumtypid = t.oid
           join pg_namespace n on n.oid = t.typnamespace
           where n.nspname = 'erph'
           order by t.typname, e.enumsortorder"""
    )
    enums: dict[str, list[str]] = {}
    for name, label in rows:
        enums.setdefault(name, []).append(label)

    check("5 enum types", len(enums) == 5, f"found {sorted(enums)}")
    tv = enums.get("template_visibility", [])
    check(
        "template_visibility values = private/school/system",
        tv == ["private", "school", "system"],
        f"got {tv}",
    )
    roles = enums.get("member_role", [])
    check(
        "member_role values intact",
        roles == ["guru_biasa", "gpk", "guru_besar", "pentadbir", "system"],
        f"got {roles}",
    )

    # the exact class of bug this runner was written for:
    role_type = r.one(
        """select u.data_type || ' (' || u.udt_name || ')'
           from information_schema.columns u
           where u.table_schema='erph' and u.table_name='user' and u.column_name='role'"""
    )
    check(
        "erph.user.role is erph.member_role",
        role_type and role_type[0].endswith("(member_role)"),
        f"got {role_type[0] if role_type else None}",
    )

    slot = r.one(
        """select data_type from information_schema.columns
           where table_schema='erph' and table_name='rph_document' and column_name='slot_time'"""
    )
    check("erph.rph_document.slot_time exists", slot is not None, "missing")

    idx = r.one(
        "select count(*) from pg_indexes where schemaname='erph' and indexname='rph_document_uniq'"
    )[0]
    check("rph_document_uniq index", idx == 1, f"found {idx}")

    # revoke must actually have removed privileges from the API roles
    priv = r.one(
        """select count(*) from information_schema.role_table_grants
           where table_schema='erph' and table_name='user'
             and grantee in ('anon','authenticated')"""
    )[0]
    check("erph.user revoked from anon/authenticated", priv == 0, f"{priv} grants remain")

    print("\nobject inventory:")
    for label, ok, detail in checks:
        print(f"  [{'OK ' if ok else 'FAIL'}] {label}" + (f" — {detail}" if not ok else ""))
        errors += 0 if ok else 1

    # ── layer 3: behavioural smoke tests ───────────────────────────────────
    print("\nbehaviour:")
    try:
        r.q(
            """
            insert into erph.school (kod_sekolah, nama, level) values ('SKTEST','Sekolah Ujian','rendah');
            insert into erph.subject (code, nama, curriculum) values ('MAT','Matematik','KSSR');
            insert into erph.user (username, password_hash, full_name, role)
            values ('uji', 'scrypt$x', 'Guru Ujian', 'guru_biasa');
            insert into erph.school_member (school_id, user_id, role)
            select s.id, u.id, 'guru_biasa' from erph.school s, erph.user u where s.kod_sekolah='SKTEST';
            insert into erph.school_setting (school_id) select id from erph.school where kod_sekolah='SKTEST';
            insert into erph.class (school_id, nama, tahun, session)
            select id, '5 Ujian', 5, '2026/2027' from erph.school where kod_sekolah='SKTEST';
            insert into erph.rph_document (school_id, owner_id, class_id, subject_code, session, week_no, plan_date)
            select s.id, u.id, c.id, 'MAT', '2026/2027', 1, '2026-10-05'
            from erph.school s, erph.user u, erph.class c
            where s.kod_sekolah='SKTEST' and c.nama='5 Ujian';
            """
        )
        conn.commit()
        print("  [OK ] insert school → user → member → class → rph_document")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print(f"  [FAIL] insert chain: {str(e).splitlines()[0][:160]}")
        errors += 1

    # completeness: an empty payload must score 0, a full one 100
    try:
        empty = r.one("select erph.rph_completeness('{}'::jsonb)")[0]
        full = r.one(
            """select erph.rph_completeness(jsonb_build_object(
                 'standard_kandungan','x','standard_pembelajaran','y','objektif','z',
                 'aktiviti', jsonb_build_array(jsonb_build_object('aktiviti_guru','a')),
                 'refleksi','r','intervensi','i'))"""
        )[0]
        ok = empty == 0 and full == 100
        print(f"  [{'OK ' if ok else 'FAIL'}] rph_completeness 0 -> 100 (got {empty} -> {full})")
        errors += 0 if ok else 1
    except Exception as e:  # noqa: BLE001
        print(f"  [FAIL] rph_completeness: {str(e).splitlines()[0][:160]}")
        errors += 1

    # the guard trigger must refuse a direct status change
    try:
        r.q(
            """update erph.rph_document set status = 'approved'
               where school_id = (select id from erph.school where kod_sekolah='SKTEST')"""
        )
        conn.commit()
        print("  [FAIL] guard_review_fields allowed a direct status change")
        errors += 1
    except Exception:  # noqa: BLE001
        conn.rollback()
        print("  [OK ] guard_review_fields blocks direct status change")

    # authorization: with no actor resolvable (plain SQL, no JWT, no header),
    # submit_rph must refuse — this is the NULL-actor bypass regression test.
    try:
        r.q(
            """select erph.submit_rph(
                 (select id from erph.rph_document
                  where school_id = (select id from erph.school where kod_sekolah='SKTEST')),
                 false)"""
        )
        conn.commit()
        print("  [FAIL] submit_rph accepted a NULL actor (authorization bypass)")
        errors += 1
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        msg = str(e).splitlines()[0]
        if "Belum log masuk" in msg or "Tidak dibenarkan" in msg:
            print(f"  [OK ] submit_rph refuses a NULL actor ({msg.split(':')[0].strip()})")
        else:
            print(f"  [FAIL] submit_rph raised the wrong error: {msg[:140]}")
            errors += 1

    # actor() with no request context must resolve to NULL (fail closed)
    try:
        actor = r.one("select erph.actor()")[0]
        ok = actor is None
        print(f"  [{'OK ' if ok else 'FAIL'}] erph.actor() is NULL without a request (got {actor})")
        errors += 0 if ok else 1
    except Exception as e:  # noqa: BLE001
        print(f"  [FAIL] erph.actor(): {str(e).splitlines()[0][:160]}")
        errors += 1

    # ── two-stage chain: Guru Biasa → GPK semak → Guru Besar lulus ────────
    # Each rung may only move a plan out of the stage it owns, so this asserts
    # the refusals as well as the happy path. `actor()` is fed through
    # `request.jwt.claims` — the unprivileged path it trusts.
    # Resolved once to the row's **id**, not to a subquery on `kod_sekolah`.
    # The school-identity test below deliberately changes that code — which is
    # the whole point of the feature — and everything after it has to keep
    # finding this same row: the restore, the policy checks, and the DELETE
    # that reaps the fixture. Keying on a value the test is allowed to move is
    # how a single failed assertion turned into leaked fixtures and three
    # unrelated seed failures.
    fixture_school_id = r.one("select id from erph.school where kod_sekolah='SKTEST'")[0]
    SK = f"'{fixture_school_id}'"
    DOC = f"(select id from erph.rph_document where school_id = {SK})"

    def act_as(username: str) -> None:
        r.q(
            "select set_config('request.jwt.claims', "
            f"(select json_build_object('sub', id)::text from erph.user "
            f" where username = '{username}'), false)"
        )
        conn.commit()

    def refused(sql: str) -> str:
        try:
            r.q(sql)
            conn.commit()
            return ""
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            return str(e).splitlines()[0]

    try:
        r.q(
            f"""
            insert into erph.user (username, password_hash, full_name, role)
            values ('gpk.uji', 'scrypt$x', 'GPK Ujian', 'gpk'),
                   ('gb.uji',  'scrypt$x', 'GB Ujian',  'guru_besar');
            insert into erph.school_member (school_id, user_id, role)
            select s.id, u.id, u.role from erph.school s, erph.user u
            where s.kod_sekolah = 'SKTEST'
              and u.username in ('gpk.uji', 'gb.uji');
            """
        )
        conn.commit()

        act_as("uji")
        r.q(f"select erph.submit_rph({DOC}, true)")
        conn.commit()

        stage: list[tuple[str, bool]] = []

        # `1::smallint`: an unadorned literal is `integer`, and int4→int2 is an
        # assignment cast, so the call would not resolve at all.
        msg = refused(f"select erph.semak_rph({DOC}, 1::smallint)")
        stage.append(("Guru Biasa cannot semak", "Guru Penolong Kanan" in msg))

        act_as("gpk.uji")
        r.q(f"select erph.semak_rph({DOC}, 1::smallint)")
        conn.commit()
        status = r.one(f"select status::text from erph.rph_document where id = {DOC}")[0]
        stage.append(("GPK semak -> forwarded", status == "forwarded"))

        msg = refused(f"select erph.lulus_rph({DOC}, 1::smallint)")
        stage.append(("GPK cannot lulus", "Guru Besar" in msg))

        msg = refused(f"select erph.semak_rph({DOC}, 1::smallint)")
        stage.append(("GPK cannot re-semak", "peringkat semakan GPK" in msg))

        act_as("gb.uji")
        msg = refused(f"select erph.semak_rph({DOC}, 1::smallint)")
        stage.append(("Guru Besar cannot semak", "Guru Penolong Kanan" in msg))

        r.q(f"select erph.lulus_rph({DOC}, 1::smallint)")
        conn.commit()
        status = r.one(f"select status::text from erph.rph_document where id = {DOC}")[0]
        stage.append(("Guru Besar lulus -> approved", status == "approved"))

        for label, ok in stage:
            print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
            errors += 0 if ok else 1
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print(f"  [FAIL] two-stage chain: {str(e).splitlines()[0][:160]}")
        errors += 1

    # ── admin set-up: every gate must actually refuse ───────────────────────
    # These are `security definer` functions that bypass RLS, so the role check
    # *inside* them is the only thing standing between a teacher and the ability
    # to mint accounts or reset passwords. Executing them as a non-admin is the
    # only way to prove the check fires rather than merely being present.
    try:
        r.q(
            """
            insert into erph.user (username, password_hash, full_name, role)
            values ('admin.uji', 'scrypt$x', 'Pentadbir Ujian', 'pentadbir');
            insert into erph.school_member (school_id, user_id, role)
            select s.id, u.id, 'pentadbir' from erph.school s, erph.user u
            where s.kod_sekolah = 'SKTEST' and u.username = 'admin.uji';
            """
        )
        conn.commit()

        admin: list[tuple[str, bool]] = []
        NEW_HASH = "'scrypt$16384$8$1$abcdefghijklmnop$qrstuvwxyz'"

        # A Guru Biasa must not be able to reach any of the admin functions.
        act_as("uji")
        msg = refused(
            f"select erph.admin_create_member({SK}, 'guru.baru', 'Guru Baru', "
            f"'guru_biasa', {NEW_HASH})"
        )
        admin.append(("Guru Biasa cannot create an account", "pentadbir" in msg))

        msg = refused(
            f"select erph.admin_reset_password({SK}, (select id from erph.user "
            f"where username='uji'), {NEW_HASH})"
        )
        admin.append(("Guru Biasa cannot reset a password", "pentadbir" in msg))

        msg = refused(f"select erph.admin_set_class({SK}, null, '6 Ujian', 6::smallint, '2026/2027', true)")
        admin.append(("Guru Biasa cannot add a class", "pentadbir" in msg))

        msg = refused(f"select erph.admin_set_subject({SK}, 'MAT', false)")
        admin.append(("Guru Biasa cannot deactivate a subject", "pentadbir" in msg))

        # The administrator reaches all of them.
        act_as("admin.uji")
        new_id = r.one(
            f"select erph.admin_create_member({SK}, 'guru.baru', 'Guru Baru', "
            f"'guru_biasa', {NEW_HASH})"
        )[0]
        # Commit now: the next assertion deliberately rolls back on refusal, and
        # an uncommitted insert would be undone by that rollback.
        conn.commit()
        admin.append(("Administrator creates an account", new_id is not None))

        # The account must be enrolled too: a user with no school cannot sync,
        # review or report, and would be invisible to the list that fixes it.
        enrolled = r.one(
            f"select count(*) from erph.school_member m join erph.user u on u.id=m.user_id "
            f"where m.school_id = {SK} and u.username='guru.baru'"
        )[0]
        admin.append(("new account is enrolled in the school", enrolled == 1))

        # Duplicate usernames must be refused, on the lowercased name — `Admin`
        # and `admin` are the same person to a case-insensitive login.
        msg = refused(
            f"select erph.admin_create_member({SK}, 'GURU.BARU', 'Seorang Lagi', "
            f"'guru_biasa', {NEW_HASH})"
        )
        admin.append(
            ("duplicate username refused case-insensitively", "telah digunakan" in msg)
        )

        # Creating the same class twice must name the class, not raise a raw
        # unique_violation that would surface in the UI as Postgres jargon.
        r.q(f"select erph.admin_set_class({SK}, null, '6 Ujian', 6::smallint, '2026/2027', true)")
        conn.commit()
        msg = refused(f"select erph.admin_set_class({SK}, null, '6 Ujian', 6::smallint, '2026/2027', true)")
        admin.append(("duplicate class refused by name", "sudah wujud" in msg))

        # Password reset must invalidate the old password and clear the lockout.
        r.q(
            f"update erph.user set failed_logins = 5, locked_until = now() + interval '15 minutes' "
            f"where username = 'guru.baru'"
        )
        conn.commit()
        r.q(
            f"select erph.admin_reset_password({SK}, "
            f"(select id from erph.user where username='guru.baru'), {NEW_HASH})"
        )
        conn.commit()
        lock = r.one(
            "select failed_logins, locked_until from erph.user where username='guru.baru'"
        )
        admin.append(("reset clears the lockout", lock[0] == 0 and lock[1] is None))

        # The session is an administrator setting now, so a malformed one has to
        # be caught here rather than surfacing as a CHECK-constraint violation.
        msg = refused(
            f"select erph.admin_set_setting({SK}, 5::smallint, '16:00', true, 'sekolah-2026')"
        )
        admin.append(("malformed session refused", "TTTT/TTTT" in msg))

        r.q(f"select erph.admin_set_setting({SK}, 5::smallint, '16:00', true, '2027/2028')")
        conn.commit()
        sess = r.one(
            f"select current_session from erph.school_setting where school_id = {SK}"
        )[0]
        admin.append(("administrator can roll the session over", sess == "2027/2028"))
        # Put it back so later assertions see the fixture's own value.
        r.q(f"select erph.admin_set_setting({SK}, 5::smallint, '16:00', true, '2026/2027')")
        conn.commit()

        # ── school identity ───────────────────────────────────────────────
        act_as("uji")
        msg = refused(
            f"select erph.admin_set_school({SK}, 'SKTEST', 'Tidak Sah', null, null, null, '/logo.png')"
        )
        admin.append(("Guru Biasa cannot change school info", "pentadbir" in msg))

        act_as("admin.uji")
        msg = refused(
            f"select erph.admin_set_school({SK}, 'SKTEST', 'X', null, null, null, 'javascript:alert(1)')"
        )
        admin.append(("malformed logo URL refused", "URL" in msg))

        # The code is checked before anything is written, so a malformed one
        # changes nothing at all — and the message is a sentence a person can
        # act on rather than Postgres naming a constraint.
        msg = refused(
            f"select erph.admin_set_school({SK}, 'bad code!', 'X', null, null, null, '/logo.png')"
        )
        admin.append(("malformed school code refused", "3-24 aksara" in msg, msg))
        admin.append(
            (
                "a refused write leaves the code alone",
                r.one(f"select kod_sekolah from erph.school where id = {SK}")[0] == "SKTEST",
            )
        )

        # The code is a label, not a foreign key — nothing joins on it — so
        # changing it has to be possible for a pentadbir. It is changed here
        # and put straight back: every fixture below resolves this school
        # through `kod_sekolah='SKTEST'`, so leaving it as SK9999 would make
        # the assertions (and the cleanup) silently see no rows at all.
        r.q(
            f"select erph.admin_set_school({SK}, 'SK9999', 'Sekolah Ujian Baharu', 'PPD Ujian', "
            f"'JPN Ujian', 'Bersatu Kita Teguh', '/logo.png')"
        )
        conn.commit()
        row = r.one(
            f"select kod_sekolah, nama, ppd, motto, logo_url from erph.school where id = {SK}"
        )
        admin.append(
            (
                "administrator can set school info and its code",
                row
                == (
                    "SK9999",
                    "Sekolah Ujian Baharu",
                    "PPD Ujian",
                    "Bersatu Kita Teguh",
                    "/logo.png",
                ),
                str(row),
            )
        )

        # Restore the fixture's own code — `SK` is a subquery on it, and so is
        # the DELETE that reaps this fixture.
        r.q(
            f"select erph.admin_set_school({SK}, 'SKTEST', 'Sekolah Ujian Baharu', 'PPD Ujian', "
            f"'JPN Ujian', null, null)"
        )
        conn.commit()

        # ── the Administrator is visible only to a pentadbir ──────────────
        # Two policies, both of which previously let a GPK read the
        # Administrator's account through `shares_school_with` / `is_staff`.
        #
        # These must run as `authenticated`: this connection owns the tables
        # and owners bypass RLS entirely, so querying as ourselves would prove
        # nothing but our own privilege. `SET ROLE` is transactional, so a
        # rollback restores it along with everything else.
        def visible_to_gpk(sql: str):
            """Row count the GPK sees, or `denied` if the grant refused outright."""
            try:
                r.q("set role authenticated")
                value = r.q(sql)[0][0]
                conn.commit()
                return value
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                return f"denied: {str(e).splitlines()[0][:60]}"

        act_as("gpk.uji")
        profiles = visible_to_gpk("select count(*) from erph.user where role = 'pentadbir'")
        admin.append(
            ("a GPK cannot read a pentadbir's profile", profiles in (0,) or str(profiles).startswith("denied"), str(profiles))
        )
        members = visible_to_gpk(
            "select count(*) from erph.school_member where role = 'pentadbir'"
        )
        admin.append(("a GPK cannot read a pentadbir's membership", members == 0, str(members)))
        # …but they can still see themselves, or monitoring breaks for exactly
        # the people who need it.
        own = visible_to_gpk("select count(*) from erph.school_member where role = 'gpk'")
        admin.append(("a GPK still reads their own membership", own == 1, str(own)))

        # `SET ROLE` survives a COMMIT (it is reverted by ROLLBACK only), so the
        # seed below would otherwise run as `authenticated` and hit RLS.
        r.q("reset role")
        conn.commit()

        for label, ok, *rest in admin:
            print(f"  [{'OK ' if ok else 'FAIL'}] {label}")
            errors += 0 if ok else 1
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print(f"  [FAIL] admin set-up: {str(e).splitlines()[0][:160]}")
        errors += 1

    # ── clean up EVERYTHING the behaviour tests created, before seeding ────
    # Order matters: rph_document.school_id has no ON DELETE (deliberate — a
    # statutory record must not vanish with its school), so the document has to
    # go first or the school delete fails and every later count is polluted by
    # fixture rows (this is exactly how the seed assertions first "failed").
    try:
        r.q(
            f"""
            -- rph_revision is append-only: only a purge may delete from it.
            select set_config('app.purge', '1', false);
            delete from erph.rph_document where school_id = {SK};
            delete from erph.school where id = {SK};  -- cascades member/class/setting
            delete from erph.user where username in
              ('uji', 'gpk.uji', 'gb.uji', 'admin.uji', 'guru.baru');
            delete from erph.subject where code = 'MAT';
            select set_config('app.purge', '0', false);
            """
        )
        conn.commit()
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print(f"  [cleanup] {str(e).splitlines()[0][:160]}")

    # ── layer 4: seed data ────────────────────────────────────────────────
    # The seed is SQL too, so it gets executed and asserted on rather than
    # trusted: a hash column that silently lost its value, or a membership row
    # that never landed, would only surface as "why can't I log in?".
    seed_file = ROOT / "db" / "seed.sql"
    if not seed_file.exists():
        print("\nseed: db/seed.sql not found — skipped")
    else:
        print("\nseed:")
        seed_sql = seed_file.read_text(encoding="utf-8")
        seed_errors_before = errors
        try:
            with conn.cursor() as cur:
                cur.execute(seed_sql)
            conn.commit()
            print("  [OK ] db/seed.sql applied")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f"  [FAIL] {str(e).splitlines()[0][:190]}")
            errors += 1

        if errors == seed_errors_before:
            seed_checks: list[tuple[str, bool, str]] = []

            def scheck(label, cond, detail=""):
                seed_checks.append((label, bool(cond), detail))

            n_users = r.one("select count(*) from erph.user")[0]
            roles = {row[0] for row in r.q("select distinct role from erph.user")}
            expected_roles = {
                "guru_biasa",
                "gpk",
                "guru_besar",
                "pentadbir",
                "system",
            }
            scheck(
                "one account per member_role",
                n_users == 5 and roles == expected_roles,
                f"{n_users} accounts, roles={sorted(roles)}",
            )

            orphan = r.one(
                """select count(*) from erph.user u
                   where u.is_active
                     and not exists (select 1 from erph.school_member m
                                     where m.user_id = u.id)"""
            )[0]
            scheck("every active account has a school membership", orphan == 0, f"{orphan} orphaned")

            bad_hash = r.one(
                """select count(*) from erph.user
                   where is_active and password_hash not like 'scrypt$%'"""
            )[0]
            scheck("active accounts carry a scrypt hash", bad_hash == 0, f"{bad_hash} malformed")

            inactive = r.one(
                "select count(*) from erph.user where role = 'system' and not is_active"
            )[0]
            scheck("system account cannot log in (is_active=false)", inactive == 1, f"got {inactive}")

            n_subj = r.one("select count(*) from erph.subject")[0]
            n_cls = r.one("select count(*) from erph.class")[0]
            scheck("3 subjects and 3 classes", n_subj == 3 and n_cls == 3,
                   f"subjects={n_subj} classes={n_cls}")

            submitted = r.one(
                """select count(*) from erph.rph_document where status = 'submitted'"""
            )[0]
            scheck("one submitted plan for the reviewer screens", submitted == 1,
                   f"found {submitted}")

            # the seeded plan must actually satisfy KPM completeness, or the
            # reviewer would grade something the teacher could not have submitted
            pct = r.one(
                """select erph.rph_completeness(payload) from erph.rph_document
                   where status = 'submitted' limit 1"""
            )
            scheck("seeded plan scores 100% complete", pct and pct[0] == 100,
                   f"got {pct[0] if pct else None}")

            print("seed inventory:")
            for label, ok, detail in seed_checks:
                print(
                    f"  [{'OK ' if ok else 'FAIL'}] {label}"
                    + (f" — {detail}" if not ok else "")
                )
                if not ok:
                    errors += 1

    conn.close()
    print()
    print("RESULT:", "schema executed + verified" if errors == 0 else f"{errors} failure(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
