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
    delta5 = (ROOT / "db" / "migrations" / "005_pantau_teachers.sql").read_text(
        encoding="utf-8"
    )
    delta6 = (ROOT / "db" / "migrations" / "006_google_identity.sql").read_text(
        encoding="utf-8"
    )
    delta7 = (ROOT / "db" / "migrations" / "007_school_template.sql").read_text(
        encoding="utf-8"
    )
    delta8 = (ROOT / "db" / "migrations" / "008_reminders.sql").read_text(
        encoding="utf-8"
    )
    delta9 = (ROOT / "db" / "migrations" / "009_week_history.sql").read_text(
        encoding="utf-8"
    )
    delta10 = (ROOT / "db" / "migrations" / "010_pantau_range.sql").read_text(
        encoding="utf-8"
    )
    delta11 = (ROOT / "db" / "migrations" / "011_fix_rate.sql").read_text(
        encoding="utf-8"
    )
    delta12 = (ROOT / "db" / "migrations" / "012_jawatan.sql").read_text(
        encoding="utf-8"
    )
    delta13 = (ROOT / "db" / "migrations" / "013_week_expectation.sql").read_text(
        encoding="utf-8"
    )
    delta14 = (ROOT / "db" / "migrations" / "014_compliance_truth.sql").read_text(
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
            run(delta5, "005")
            run(delta6, "006")
            run(delta7, "007")
            run(delta8, "008")
            run(delta9, "009")
            run(delta10, "010")
            run(delta11, "011")
            run(delta12, "012")
            run(delta13, "013")
            run(delta14, "014")
        print(
            "  [OK ] migration applied (001a→014, old signature pre-installed)"
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
            " 'pantau_teachers','admin_set_supervisor','admin_list_members',"
            " 'admin_set_member',"
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
    check("17 functions present", new_fns == 17, f"found {new_fns}")
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

    # The views key on status now. `v_school_compliance` asks
    # `school_week_stats` for the headcount, which answers only for a member of
    # the school — so a member reads it and a stranger is refused outright.
    # Both halves are the behaviour to pin.
    try:
        with conn.cursor() as cur:
            cur.execute("select count(*) from erph.v_teacher_week")
            cur.fetchone()
        check("views rebuilt", True)
    except Exception as e:  # noqa: BLE001
        check("views rebuilt", False, str(e).splitlines()[0][:120])

    try:
        with conn.cursor() as cur:
            cur.execute("select count(*) from erph.v_school_compliance")
        conn.rollback()
        check(
            "v_school_compliance fails closed for a stranger",
            False,
            "an anonymous caller could read the school's compliance",
        )
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        check(
            "v_school_compliance fails closed for a stranger",
            "Tidak dibenarkan" in str(e),
            str(e).splitlines()[0][:120],
        )

    try:
        with conn.cursor() as cur:
            cur.execute(
                "select set_config('request.jwt.claims', "
                "(select json_build_object('sub', id)::text from erph.user "
                " where username = 'pentadbir.sk'), false)"
            )
            conn.commit()
            cur.execute("select count(*) from erph.v_school_compliance")
            cur.fetchone()
        check("v_school_compliance answers for a member", True)
    except Exception as e:  # noqa: BLE001
        check("v_school_compliance answers for a member", False, str(e).splitlines()[0][:120])
    finally:
        with conn.cursor() as cur:
            # Back to nobody: the checks below prove what an *anonymous*
            # caller cannot do, and a leftover subject would make each of
            # them pass for the wrong reason.
            cur.execute("select set_config('request.jwt.claims', null, false)")
            conn.commit()

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

    # ── 006: Google sign-in identity ────────────────────────────────────────
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from information_schema.columns "
                "where table_schema='erph' and table_name='user' "
                "and column_name in ('google_sub','google_email')"
            )
            check("erph.user gained google_sub + google_email", cur.fetchone()[0] == 2)

            # The UNIQUE index is what makes linking idempotent: two concurrent
            # first sign-ins cannot both claim one identity, and the loser gets
            # a constraint violation rather than a second binding.
            cur.execute(
                "select count(*) from information_schema.table_constraints "
                "where table_schema='erph' and table_name='user' "
                "and constraint_type='UNIQUE' and constraint_name='user_google_sub_uniq'"
            )
            check("google_sub is uniquely constrained", cur.fetchone()[0] == 1)
    except Exception as e:  # noqa: BLE001
        check("006 google identity", False, str(e).splitlines()[0][:140])

    # ── 007: the school's own RPH template ───────────────────────────────────
    try:
        with conn.cursor() as cur:
            # Masa Tamat is printed, so it has to be stored. The default matters
            # as much as the column: without it every plan written before this
            # migration would print a dash where a time belongs.
            cur.execute(
                "select column_default from information_schema.columns "
                "where table_schema='erph' and table_name='rph_document' "
                "and column_name='slot_time_end'"
            )
            row = cur.fetchone()
            check(
                "rph_document gained slot_time_end, defaulted",
                row is not None and "12:40" in (row[0] or ""),
                str(row[0]) if row else "missing",
            )

            # Kriteria Kejayaan replaces Intervensi/EMK. A payload that fills
            # every printed row scores 100 with no intervensi anywhere in it…
            cur.execute(
                "select erph.rph_completeness(jsonb_build_object("
                "'standard_kandungan','x','standard_pembelajaran','y',"
                "'objektif','z','kriteria_kejayaan','k',"
                "'aktiviti', jsonb_build_array(jsonb_build_object('nama','a')),"
                "'refleksi','r'))"
            )
            check(
                "007 completeness scores Kriteria Kejayaan → 100",
                cur.fetchone()[0] == 100,
            )

            # …and a payload that carries a full Intervensi but no Kriteria
            # Kejayaan stops at 75. That is the whole point of the redefinition:
            # content the printed form never shows must not be worth points.
            cur.execute(
                "select erph.rph_completeness(jsonb_build_object("
                "'standard_kandungan','x','standard_pembelajaran','y',"
                "'objektif','z','intervensi','i','emk', jsonb_build_array('e'),"
                "'aktiviti', jsonb_build_array(jsonb_build_object('nama','a')),"
                "'refleksi','r'))"
            )
            check(
                "007 Intervensi/EMK no longer score → 75",
                cur.fetchone()[0] == 75,
            )

            # A changed parameter list makes Postgres create a *new* function
            # rather than replace, so a migration that forgets to drop leaves
            # the previous overload callable beside the new one. That is what
            # migration 010 did, and nothing else in the sequence would notice.
            cur.execute("select count(*)::int from pg_proc where proname = 'pantau_teachers'")
            n_pantau = cur.fetchone()[0]
            check(
                "pantau_teachers has exactly one overload",
                n_pantau == 1,
                f"found {n_pantau}",
            )
    except Exception as e:  # noqa: BLE001
        check("007 school template", False, str(e).splitlines()[0][:140])

    # ── 012: the office printed on the cover sheet ──────────────────────────
    try:
        with conn.cursor() as cur:
            # The type and the column are created by 001b for a database built
            # from scratch (002 and 004 name them in signatures that cannot be
            # created without them); 012 is what a database that ran the
            # original 001b gets. By this point both must exist either way.
            cur.execute("select enum_range(null::erph.jawatan)::text")
            jawatans = cur.fetchone()[0]
            check(
                "012 jawatan carries the five offices",
                all(
                    j in jawatans
                    for j in ("guru_biasa", "pk_pentadbiran", "pk_hem", "pk_kokum", "guru_besar")
                ),
                jawatans,
            )
            cur.execute(
                "select count(*) from information_schema.columns "
                "where table_schema='erph' and table_name='user' and column_name='jawatan'"
            )
            check("erph.user gained jawatan", cur.fetchone()[0] == 1)

            # The backfill is deliberately partial: it fills what the role
            # already states outright and invents nothing, because a cover
            # sheet that names an office nobody set is the bug being fixed.
            cur.execute(
                "select count(*) from erph.user "
                "where role in ('guru_biasa', 'guru_besar') and jawatan is null"
            )
            check("backfill covers the roles that state an office", cur.fetchone()[0] == 0)
            cur.execute("select count(*) from erph.user where role = 'gpk' and jawatan is not null")
            check("…and invents none for a GPK", cur.fetchone()[0] == 0)

            cur.execute(
                "select pg_get_function_result(p.oid) from pg_proc p "
                "join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='erph' and p.proname='admin_list_members'"
            )
            check("admin_list_members returns the jawatan", "jawatan" in cur.fetchone()[0])

            # The two shapes that changed needed a drop first. Counting them
            # is what notices a missing one: `create or replace` would happily
            # leave the previous arity callable beside the new one.
            cur.execute(
                "select p.proname, count(*)::int from pg_proc p "
                "join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='erph' and p.proname in "
                "('admin_list_members','admin_create_member','admin_set_member',"
                "'admin_set_jawatan','jawatan_for') "
                "group by 1 order by 1"
            )
            counts = dict(cur.fetchall())
            check(
                "012 leaves exactly one signature of each function",
                len(counts) == 5 and all(v == 1 for v in counts.values()),
                str(counts),
            )
    except Exception as e:  # noqa: BLE001
        check("012 jawatan column and functions", False, str(e).splitlines()[0][:140])

    # The behaviour, not just the shape: the accounts screen reports a role
    # change as done, and this is the write that has to make it true.
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select set_config('request.jwt.claims', "
                "(select json_build_object('sub', id)::text from erph.user "
                " where username = 'pentadbir.sk'), false)"
            )
            conn.commit()
            cur.execute(
                "select id from erph.user where role = 'guru_biasa' and is_active limit 1"
            )
            teacher = cur.fetchone()[0]
            cur.execute(
                "select erph.admin_set_member((select id from erph.school limit 1), "
                "%s, 'gpk', true)",
                (teacher,),
            )
            conn.commit()
            cur.execute("select role, jawatan from erph.user where id = %s", (teacher,))
            new_role, new_jawatan = cur.fetchone()
            check(
                "012 the role change reaches erph.user, not only school_member",
                new_role == "gpk",
                str(new_role),
            )
            # 'guru_biasa' is not an office a GPK holds, so it goes rather
            # than being printed under a name that never had it.
            check(
                "012 an office the new role cannot hold is cleared",
                new_jawatan is None,
                str(new_jawatan),
            )

            # And the mismatch is refused rather than stored.
            cur.execute("select id from erph.user where role = 'gpk' limit 1")
            gpk_user = cur.fetchone()[0]
            try:
                cur.execute(
                    "select erph.admin_set_jawatan((select id from erph.school limit 1), "
                    "%s, 'guru_besar')",
                    (gpk_user,),
                )
                conn.rollback()
                check("012 admin_set_jawatan refuses a mismatched office", False, "no exception")
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                check(
                    "012 admin_set_jawatan refuses a mismatched office",
                    "tidak sepadan" in str(e),
                    str(e).splitlines()[0][:120],
                )

            # Leave the seed as it was found: the checks above read counts by
            # role, and a teacher left holding a GPK's office would change them.
            cur.execute(
                "select erph.admin_set_member((select id from erph.school limit 1), "
                "%s, 'guru_biasa', true)",
                (teacher,),
            )
            conn.commit()
            cur.execute(
                "update erph.user set jawatan = 'guru_biasa' where id = %s",
                (teacher,),
            )
            conn.commit()
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        check("012 role change and jawatan guard", False, str(e).splitlines()[0][:140])

    # ── 013: the denominator behind "pematuhan sekolah" ─────────────────────
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select column_default from information_schema.columns "
                "where table_schema='erph' and table_name='school_setting' "
                "and column_name='rph_per_week'"
            )
            row = cur.fetchone()
            check(
                "013 school_setting gained rph_per_week, defaulted",
                row is not None and "5" in (row[0] or ""),
                str(row[0]) if row else "missing",
            )

            # A changed *return type* is the one thing `create or replace`
            # refuses outright, so the drop is what makes the new column
            # readable — and both statistics functions gained one. The third
            # gained a parameter, which would otherwise leave the old arity
            # callable beside it.
            cur.execute(
                "select pg_get_function_result(p.oid) from pg_proc p "
                "join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='erph' and p.proname='school_week_stats'"
            )
            check(
                "013 school_week_stats returns the headcount",
                "teachers" in cur.fetchone()[0],
            )
            cur.execute(
                "select pg_get_function_identity_arguments(p.oid) from pg_proc p "
                "join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='erph' and p.proname='admin_set_setting'"
            )
            setting_args = cur.fetchone()[0]
            check(
                "013 admin_set_setting takes the weekly rule",
                "rph_per_week" in setting_args,
                setting_args,
            )
            cur.execute(
                "select p.proname, count(*)::int from pg_proc p "
                "join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='erph' and p.proname in "
                "('school_week_stats','school_week_history','admin_set_setting') "
                "group by 1 order by 1"
            )
            counts = dict(cur.fetchall())
            check(
                "013 leaves exactly one signature of each",
                len(counts) == 3 and all(v == 1 for v in counts.values()),
                str(counts),
            )
    except Exception as e:  # noqa: BLE001
        check("013 week expectation", False, str(e).splitlines()[0][:140])

    # ── 014: the percentage must never lie ──────────────────────────────────
    def apply_014(cur) -> None:
        """Re-run 014. Every statement in it is idempotent, so this is safe."""
        for _offset, stmt in rs.split_statements(delta14):
            clean = "\n".join(
                ln for ln in stmt.splitlines() if not ln.strip().startswith("--")
            ).strip()
            if clean:
                cur.execute(clean)

    try:
        with conn.cursor() as cur:
            cur.execute(
                "select column_name from information_schema.columns "
                "where table_schema='erph' and table_name='v_school_compliance' "
                "and column_name in ('teachers','expected','compliance_pct')"
            )
            cols = {r[0] for r in cur.fetchall()}
            check(
                "014 the view carries the headcount and the expectation",
                cols == {"teachers", "expected", "compliance_pct"},
                str(sorted(cols)),
            )
    except Exception as e:  # noqa: BLE001
        check("014 view rebuilt", False, str(e).splitlines()[0][:140])

    # `least(100, NULL)` is 100 in Postgres, so a school with no active Guru
    # Biasa has no denominator at all and must come back unscored — otherwise
    # an empty school reports full compliance.
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select set_config('request.jwt.claims', "
                "(select json_build_object('sub', id)::text from erph.user "
                " where username = 'pentadbir.sk'), false)"
            )
            conn.commit()
            cur.execute(
                "update erph.school_member set is_active = false "
                " where school_id = (select id from erph.school limit 1) "
                " and role = 'guru_biasa'"
            )
            conn.commit()
            cur.execute(
                "select compliance from erph.school_week_stats("
                "(select id from erph.school limit 1), '2026/2027'::text, 1::smallint)"
            )
            row = cur.fetchone()
            cur.execute(
                "update erph.school_member set is_active = true "
                " where school_id = (select id from erph.school limit 1)"
            )
            conn.commit()
            check(
                "014 a school with no teacher is not scored 100%",
                row is not None and row[0] is None,
                str(row[0]) if row else "no row",
            )
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        check("014 zero-denominator week", False, str(e).splitlines()[0][:140])

    # `admin_set_member` wrote only `school_member.role` until 012, so an
    # account changed through the console before then carries two roles — and
    # the route guard reads the stale one.
    try:
        with conn.cursor() as cur:
            cur.execute("select id from erph.school order by kod_sekolah limit 1")
            school = cur.fetchone()[0]
            cur.execute(
                "insert into erph.user (username, password_hash, full_name, role) "
                "values ('karut.uji', 'scrypt$16384$8$1$x$y', 'Karut Uji', 'guru_biasa') "
                "returning id"
            )
            stale = cur.fetchone()[0]
            cur.execute(
                "insert into erph.school_member (school_id, user_id, role) "
                "values (%s, %s, 'gpk')",
                (school, stale),
            )
            conn.commit()
            apply_014(cur)
            conn.commit()
            cur.execute("select role::text from erph.user where id = %s", (stale,))
            role = cur.fetchone()[0]
            check(
                "014 the guard's role is brought into line with the membership",
                role == "gpk",
                role,
            )

            # A user in two schools is left as they are: reconciling would
            # mean picking one of them for them.
            cur.execute(
                "insert into erph.school (kod_sekolah, nama, level) "
                "values ('SKUJI', 'Sekolah Kedua Uji', 'rendah')"
            )
            cur.execute(
                "insert into erph.school_member (school_id, user_id, role) "
                "select id, %s, 'guru_biasa' from erph.school where kod_sekolah = 'SKUJI'",
                (stale,),
            )
            conn.commit()
            apply_014(cur)
            conn.commit()
            cur.execute("select role::text from erph.user where id = %s", (stale,))
            still = cur.fetchone()[0]
            check(
                "014 …and a user in two schools is left to be decided",
                still == "gpk",
                still,
            )
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        check("014 role reconciliation", False, str(e).splitlines()[0][:140])

    print()
    for label, ok, detail in checks:
        print(f"  [{'OK ' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
        if not ok:
            errors += 1

    print(f"\nRESULT: {errors} failure(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
