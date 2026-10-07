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
        "2 policies on storage.objects",
        n_storage == 2,
        f"found {n_storage} (only the ones this file creates)",
    )

    n_funcs = r.one(
        """select count(*) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'erph' and p.proname not in ('foldername')"""
    )[0]
    check("16 functions in erph", n_funcs == 16, f"found {n_funcs}")

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
        roles == ["teacher", "coordinator", "admin", "ppd", "jpn", "system"],
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
            values ('uji', 'scrypt$x', 'Guru Ujian', 'teacher');
            insert into erph.school_member (school_id, user_id, role)
            select s.id, u.id, 'teacher' from erph.school s, erph.user u where s.kod_sekolah='SKTEST';
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
        if "Not authenticated" in msg or "Not allowed" in msg:
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

    # ── clean up EVERYTHING the behaviour tests created, before seeding ────
    # Order matters: rph_document.school_id has no ON DELETE (deliberate — a
    # statutory record must not vanish with its school), so the document has to
    # go first or the school delete fails and every later count is polluted by
    # fixture rows (this is exactly how the seed assertions first "failed").
    try:
        r.q(
            """
            delete from erph.rph_document
             where school_id = (select id from erph.school where kod_sekolah='SKTEST');
            delete from erph.school where kod_sekolah='SKTEST';  -- cascades member/class/setting
            delete from erph.user where username = 'uji';
            delete from erph.subject where code = 'MAT';
            """
        )
        conn.commit()
    except Exception:  # noqa: BLE001
        conn.rollback()

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
            expected_roles = {"teacher", "coordinator", "admin", "ppd", "jpn", "system"}
            scheck(
                "one account per member_role",
                n_users == 6 and roles == expected_roles,
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
