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
            # Statement by statement so a failure names the statement.
            for _offset, stmt in rs.split_statements(delta):
                clean = "\n".join(
                    ln for ln in stmt.splitlines() if not ln.strip().startswith("--")
                ).strip()
                if not clean:
                    continue
                try:
                    cur.execute(clean)
                except Exception as e:  # noqa: BLE001
                    raise RuntimeError(
                        f"{str(e).splitlines()[0][:140]} :: {clean[:140]!r}"
                    ) from e
        print("  [OK ] migration applied")
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
            "('semak_rph','lulus_rph','admin_list_members','admin_set_member','admin_set_setting')"
        )
        new_fns = cur.fetchone()[0]
        cur.execute(
            "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='erph' and p.proname='review_rph'"
        )
        old_fn = cur.fetchone()[0]

    check(
        "roles renamed",
        all(r in roles for r in ("guru_biasa", "gpk", "guru_besar", "pentadbir")),
        roles,
    )
    check("forwarded added to rph_status", "forwarded" in statuses, statuses)
    check("review_rph gone", old_fn == 0)
    check("5 new functions present", new_fns == 5, f"found {new_fns}")
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

    print()
    for label, ok, detail in checks:
        print(f"  [{'OK ' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
        if not ok:
            errors += 1

    print(f"\nRESULT: {errors} failure(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
