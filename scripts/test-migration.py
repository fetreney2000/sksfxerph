"""Prove db/migrations/001_roles_and_two_stage.sql works on a pre-rename database.

The migration is the only thing standing between an existing Supabase project
and an app that can show a navigation bar, so it gets tested rather than
eyeballed: this builds the schema and seed as they were at commit 3bdda66
(the last state an existing project is likely to be on), runs the migration
over it, and then asserts the result.

    python scripts/test-migration.py
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import run_schema as rs  # noqa: E402  (reuses its throwaway-cluster helper)

BASELINE = "3bdda66"


def from_git(rev: str, path: str) -> str:
    return subprocess.run(  # noqa: S603
        ["git", "show", f"{rev}:{path}"], cwd=ROOT, capture_output=True, check=True
    ).stdout.decode("utf-8")


def main() -> int:
    alter_a = (ROOT / "db" / "migrations" / "001a_alter_types.sql").read_text(
        encoding="utf-8"
    )
    delta = (ROOT / "db" / "migrations" / "001b_schema_delta.sql").read_text(
        encoding="utf-8"
    )
    delta2 = (ROOT / "db" / "migrations" / "002_admin_console.sql").read_text(
        encoding="utf-8"
    )
    delta3 = (ROOT / "db" / "migrations" / "003_school_identity.sql").read_text(
        encoding="utf-8"
    )
    delta4 = (ROOT / "db" / "migrations" / "004_supervision_and_signing.sql").read_text(
        encoding="utf-8"
    )
    old_schema = from_git(BASELINE, "db/schema.sql")
    old_seed = from_git(BASELINE, "db/seed.sql")

    errors = 0
    conn = rs.connect()
    conn.autocommit = True  # `rename value` refuses a transaction block

    with conn.cursor() as cur:
        cur.execute("drop schema if exists erph cascade")
        cur.execute("select count(*) from pg_available_extensions where name='pg_trgm'")
        has_trgm = cur.fetchone()[0] > 0

    def apply(cur, sql: str) -> None:
        """run_schema's splitter, with the same pg_trgm concession.

        A statement can carry a preceding comment line, so drop comment lines
        rather than skipping the whole statement — otherwise `-- note` above
        `create schema` would silently drop the schema.
        """
        for _offset, stmt in rs.split_statements(sql):
            if not has_trgm and ("pg_trgm" in stmt or "gin_trgm_ops" in stmt):
                continue
            clean = "\n".join(
                ln for ln in stmt.splitlines() if not ln.strip().startswith("--")
            ).strip()
            if not clean:
                continue
            try:
                cur.execute(clean)
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(f"{str(e).splitlines()[0][:120]} :: {clean[:120]!r}") from e

    with conn.cursor() as cur:
        cur.execute(rs.STUBS)
        apply(cur, old_schema)
        apply(cur, old_seed)

    before = {}
    with conn.cursor() as cur:
        # psycopg hands enum_range back as a string; `in` is a substring test,
        # which is all these two checks need.
        cur.execute("select enum_range(null::erph.member_role)::text")
        before["member_role"] = cur.fetchone()[0]
        cur.execute("select enum_range(null::erph.rph_status)::text")
        before["rph_status"] = cur.fetchone()[0]
        cur.execute("select count(*) from erph.user")
        before["users"] = cur.fetchone()[0]
        cur.execute("select distinct role from erph.user")
        before["roles"] = sorted(r[0] for r in cur.fetchall())
    print(f"before: {before}")

    if "teacher" not in before["member_role"]:
        print("  [FAIL] baseline does not look like a pre-rename database")
        return 1

    # ── run it ───────────────────────────────────────────────────────────────
    # 001a is every ALTER TYPE; they must go one statement at a time, exactly
    # as the file instructs a human to do in the SQL editor.
    try:
        with conn.cursor() as cur:
            for stmt in re.findall(r"(?m)^alter type[^;]+;", alter_a):
                cur.execute(stmt)

            def run(sql_text: str, label: str) -> None:
                """Statement by statement so a failure names the statement."""
                for _offset, stmt in rs.split_statements(sql_text):
                    clean = "\n".join(
                        ln for ln in stmt.splitlines() if not ln.strip().startswith("--")
                    ).strip()
                    if not clean:
                        continue
                    try:
                        cur.execute(clean)
                    except Exception as e:  # noqa: BLE001
                        raise RuntimeError(
                            f"{label}: {str(e).splitlines()[0][:140]} :: {clean[:140]!r}"
                        ) from e

            run(delta, "001b")
            # 002 drops and recreates two functions whose shape changed. Applied
            # in the same session as 001b precisely because 001b now emits the
            # *current* definitions — proving the pair works in sequence is the
            # whole point of generating both from one source.
            run(delta2, "002")
            # 003 changed `admin_set_school`'s signature when the school code
            # became editable. `create or replace` does **not** replace across
            # an arity change — it quietly adds a second function, and PostgREST
            # then resolves the RPC by argument count rather than by intent,
            # which the callers would only ever notice as a function that
            # stopped validating. Install the pre-003 form first so the drop
            # inside 003 has to prove itself; the "exactly one signature"
            # assertion below is what notices if it does not.
            cur.execute(
                "create function erph.admin_set_school("
                "p_school uuid, p_nama text, p_ppd text, p_jpn text, "
                "p_motto text, p_logo_url text) "
                "returns void language plpgsql as $stub$ begin return; end $stub$"
            )
            run(delta3, "003")
            run(delta4, "004")
        print(
            "  [OK ] migration applied (001a + 001b + 002 + 003 + 004, "
            "old signature pre-installed)"
        )
    except Exception as e:  # noqa: BLE001
        print(f"  [FAIL] {str(e).splitlines()[0][:300]}")
        return 1

    # ── assert it ───────────────────────────────────────────────────────────
    checks: list[tuple[str, bool, str]] = []

    def check(label: str, ok: bool, detail: str = "") -> None:
        checks.append((label, ok, detail))

    with conn.cursor() as cur:
        # psycopg hands enum_range back as a string; `in` is a substring test,
        # which is all these checks need.
        cur.execute("select enum_range(null::erph.member_role)::text")
        roles = cur.fetchone()[0]
        cur.execute("select enum_range(null::erph.rph_status)::text")
        statuses = cur.fetchone()[0]
        cur.execute("select distinct role from erph.user order by 1")
        live_roles = [r[0] for r in cur.fetchall()]
        cur.execute("select count(*) from erph.user")
        users = cur.fetchone()[0]
        cur.execute(
            "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='erph' and p.proname in "
            "('sahkan_rph','hantar_balik_rph','may_supervise','supervises',"
            " 'admin_set_supervisor','admin_list_members','admin_set_member',"
            " 'admin_set_setting','admin_create_member','admin_reset_password',"
            " 'admin_unlock_member','admin_list_classes','admin_set_class',"
            " 'admin_list_subjects','admin_set_subject','admin_create_subject')"
        )
        new_fns = cur.fetchone()[0]
        cur.execute(
            "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='erph' and p.proname in ('semak_rph','lulus_rph','review_rph')"
        )
        old_fn = cur.fetchone()[0]
        cur.execute(
            "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='erph' and p.proname='admin_set_setting'"
        )
        setting_overloads = cur.fetchone()[0]
        cur.execute(
            "select pg_get_function_result(p.oid) from pg_proc p "
            "join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='erph' and p.proname='admin_list_members'"
        )
        list_result = cur.fetchone()[0]
        cur.execute(
            "select count(*) from pg_indexes where schemaname='erph' "
            "and indexname='user_username_uniq'"
        )
        uniq_idx = cur.fetchone()[0]

    check(
        "roles renamed",
        all(r in roles for r in ("guru_biasa", "gpk", "guru_besar", "pentadbir")),
        roles,
    )
    check("forwarded added to rph_status", "forwarded" in statuses, statuses)
    # `review_rph` was the pre-001 shape; `semak_rph` and `lulus_rph` were
    # retired by 004 when the GPK → Guru Besar hop disappeared. None may
    # survive — a lingering one would still be callable through PostgREST and
    # would restore a flow the app no longer drives.
    check("review_rph / semak_rph / lulus_rph gone", old_fn == 0, f"found {old_fn}")
    check("16 functions present", new_fns == 16, f"found {new_fns}")
    # The exact bug the `drop` in 002 exists to prevent: an added parameter
    # makes Postgres treat the function as a *different* one, so `create or
    # replace` silently leaves the old arity behind — and calls that omit the
    # new argument keep resolving to it, ignoring the session entirely.
    check(
        "admin_set_setting has exactly one overload",
        setting_overloads == 1,
        f"found {setting_overloads}",
    )
    # Likewise the return type: `create or replace` cannot change it, so this
    # only reads the new columns if the drop actually happened.
    check(
        "admin_list_members returns the new columns",
        "last_login_at" in list_result,
        list_result[:80],
    )
    check("username uniqueness index exists", uniq_idx == 1, f"found {uniq_idx}")
    check("ppd/jpn rows removed", "ppd" not in live_roles and "jpn" not in live_roles, str(live_roles))
    check("5 roles in use", len(live_roles) == 5, str(live_roles))
    check("no orphan accounts", users == 5, f"{users} users")

    # policies must not reference a value that no longer exists
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from erph.school_member m "
                "where erph.has_role(m.school_id, array['guru_besar','gpk']::erph.member_role[])"
            )
            cur.fetchone()
        check("role arrays still evaluate", True)
    except Exception as e:  # noqa: BLE001
        check("role arrays still evaluate", False, str(e).splitlines()[0][:120])

    # the views key on status now
    try:
        with conn.cursor() as cur:
            cur.execute("select count(*) from erph.v_school_compliance")
            cur.execute("select count(*) from erph.v_teacher_week")
        check("views rebuilt", True)
    except Exception as e:  # noqa: BLE001
        check("views rebuilt", False, str(e).splitlines()[0][:120])

    # the admin path, called with no actor: must fail closed, not list everyone
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from erph.admin_list_members("
                "(select id from erph.school limit 1))"
            )
            n = cur.fetchone()[0]
        check("admin_list_members fails closed", n == 0, f"{n} rows for an anonymous caller")
    except Exception as e:  # noqa: BLE001
        check("admin_list_members fails closed", False, str(e).splitlines()[0][:120])

    # The same refusal for the *new* write path. A `security definer` function
    # bypasses RLS, so the role check inside it is the only thing between a
    # teacher and the ability to mint accounts — executing it as nobody is the
    # only way to prove the check fires rather than merely being present.
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select erph.admin_create_member((select id from erph.school limit 1), "
                "'gagal.uji', 'Tidak Seharusnya Wujud', 'guru_biasa', 'scrypt$16384$8$1$x$y')"
            )
            conn.commit()
        check("admin_create_member fails closed", False, "no exception raised")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        check(
            "admin_create_member fails closed",
            "pentadbir" in str(e),
            str(e).splitlines()[0][:120],
        )

    # The session write must reach the row. This is the check that earns the
    # `drop` in 002: had the old four-argument form survived `create or replace`
    # (it would — an added parameter makes Postgres see a *different* function),
    # the old arity would still be there and a caller omitting the session would
    # resolve to it, silently changing nothing.
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select set_config('request.jwt.claims', "
                "(select json_build_object('sub', id)::text from erph.user "
                " where username = 'pentadbir.sk'), false)"
            )
            conn.commit()
            cur.execute(
                "insert into erph.school_setting (school_id) "
                "select s.id from erph.school s where not exists "
                "(select 1 from erph.school_setting where school_id = s.id)"
            )
            conn.commit()
            cur.execute(
                "select erph.admin_set_setting((select id from erph.school limit 1), "
                "5::smallint, '16:00', true, '2031/2032')"
            )
            conn.commit()
            cur.execute("select current_session from erph.school_setting limit 1")
            got = cur.fetchone()[0]
            # Back to the seeded value so later assertions see it.
            cur.execute(
                "select erph.admin_set_setting((select id from erph.school limit 1), "
                "5::smallint, '16:00', true, '2026/2027')"
            )
            conn.commit()
        check("admin_set_setting persists the session", got == "2031/2032", got)
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        check("admin_set_setting persists the session", False, str(e).splitlines()[0][:140])

    # ── 003: the school's identity ─────────────────────────────────────────
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select column_name from information_schema.columns "
                "where table_schema='erph' and table_name='school' "
                "and column_name in ('motto','logo_url')"
            )
            cols = {r[0] for r in cur.fetchall()}
            check(
                "erph.school gained motto + logo_url",
                cols == {"motto", "logo_url"},
                str(sorted(cols)),
            )

            # `create or replace` does *not* replace on a signature change — it
            # quietly adds a second function. `admin_set_school` gained the
            # school code, so if the drop of the old arity were ever missing
            # this counts 2 and PostgREST would resolve the RPC by arity rather
            # than by intent. Same trap `admin_set_setting` was checked for in 002.
            cur.execute(
                "select count(*), max(pg_get_function_identity_arguments(p.oid)) "
                "from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='erph' and p.proname='admin_set_school'"
            )
            n_funcs, args = cur.fetchone()
            arity = len(args.split(",")) if args else 0
            check(
                "admin_set_school has exactly one signature",
                n_funcs == 1,
                f"found {n_funcs} overloads",
            )
            check(
                "admin_set_school takes the school code",
                arity == 7,
                f"{arity} params: {args}",
            )

            # The whole point of the policy change: the tightened definitions
            # must actually be the installed ones, not the pre-003 copies.
            cur.execute(
                "select count(*) from pg_policies where schemaname='erph' "
                "and policyname in ('profile_read','member_read') "
                "and qual like '%pentadbir%'"
            )
            check(
                "profile_read/member_read exclude the pentadbir",
                cur.fetchone()[0] == 2,
                "policies still lack the pentadbir condition",
            )

            cur.execute(
                "select count(*) from storage.buckets where id='school-assets' and public"
            )
            check("public school-assets bucket", cur.fetchone()[0] == 1)
    except Exception as e:  # noqa: BLE001
        check("003 school identity", False, str(e).splitlines()[0][:140])

    # ── 004: supervision scope and the signed single-stage review ────────────
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from information_schema.columns "
                "where table_schema='erph' and table_name='school_member' "
                "and column_name='supervisor_id'"
            )
            check("school_member gained supervisor_id", cur.fetchone()[0] == 1)

            cur.execute(
                "select count(*) from information_schema.tables "
                "where table_schema='erph' and table_name='rph_signature'"
            )
            check("rph_signature exists", cur.fetchone()[0] == 1)

            # The entire signing design rests on this pair. PostgreSQL cannot
            # verify ECDSA, so the database's only contribution is refusing to
            # let anyone but service_role append — and that only works while
            # the table carries no INSERT policy.
            cur.execute(
                "select count(*) from pg_policies where schemaname='erph' "
                "and tablename='rph_signature'"
            )
            n_sig_policies = cur.fetchone()[0]
            check(
                "rph_signature has exactly one policy",
                n_sig_policies == 1,
                f"found {n_sig_policies}",
            )
            cur.execute(
                "select cmd from pg_policies where schemaname='erph' "
                "and tablename='rph_signature'"
            )
            check(
                "…a SELECT, so only service_role may append a signature",
                cur.fetchone()[0] == "SELECT",
            )
    except Exception as e:  # noqa: BLE001
        check("004 supervision and signing", False, str(e).splitlines()[0][:140])

    print()
    for label, ok, detail in checks:
        print(f"  [{'OK ' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
        if not ok:
            errors += 1

    print(f"\nRESULT: {errors} failure(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
