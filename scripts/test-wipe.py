"""Prove db/ops/wipe-except-pentadbir.sql does what it claims.

The ops script is destructive and irreversible, so it is not allowed to be
something nobody has run: this harness builds the same shape of data the seed
creates — accounts, an eRPH, revisions, a review — and then

  1. confirms the append-only guard actually blocks a bare delete, and that
     deleting the accounts *first* is refused by rph_document.owner_id, so the
     ordering in that file is load-bearing rather than a style choice;
  2. runs the ops script as one multi-statement string, the way a SQL editor
     sends it;
  3. asserts exactly pentadbir.sk survives, no eRPH/templates/revisions
     remain, classes/subjects/audit log/school are untouched, and app.purge is
     switched back off;
  4. runs it a second time to prove re-running is safe.

  python scripts/test-wipe.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import run_schema as rs  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
FAILS = 0


def check(label, ok, detail=""):
    global FAILS
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILS += 1


def apply(conn, r, sql_text, label, available=frozenset()):
    skipped = 0
    for _off, text in rs.split_statements(sql_text):
        clean = "\n".join(
            ln for ln in text.splitlines() if not ln.strip().startswith("--")
        ).strip()
        if not clean:
            continue
        # Same accommodation run_schema.py makes: this bundled server has no
        # pg_trgm; Supabase does. The index is a nicety, not load-bearing here.
        if ("pg_trgm" in clean or "gin_trgm_ops" in clean) and "pg_trgm" not in available:
            skipped += 1
            continue
        try:
            r.q(clean)
        except Exception as e:  # noqa: BLE001
            print(f"[FAIL] {label}: {str(e).splitlines()[0][:170]} :: {clean[:90]!r}")
            raise
    conn.commit()
    if skipped:
        print(f"  ({label}: skipped {skipped} statement(s) needing pg_trgm)")


def main() -> int:
    conn = rs.connect()
    conn.autocommit = False
    r = rs.Runner(conn)

    with conn.cursor() as cur:
        cur.execute("drop schema if exists erph cascade")
    conn.commit()

    available = {row[0] for row in r.q("select name from pg_available_extensions")}

    apply(conn, r, rs.STUBS, "stubs", available)
    apply(conn, r, rs.SQL_FILE.read_text(encoding="utf-8"), "schema", available)
    apply(conn, r, (ROOT / "db" / "seed.sql").read_text(encoding="utf-8"), "seed", available)

    # ── give the append-only guard something to bite on ────────────────────
    # The seed writes a document but no revisions and no reviews, so the very
    # trigger this script has to defeat would never otherwise fire.
    r.q(
        """
        insert into erph.rph_revision (document_id, version, payload, completeness, reason)
        select id, 1, payload, coalesce(completeness, 0), 'create'
          from erph.rph_document;

        insert into erph.rph_review (document_id, document_version, reviewer_id, grade)
        select d.id, 1, u.id, 1
          from erph.rph_document d
          join erph.user u on u.role = 'guru_besar'
         limit 1;
        """
    )
    conn.commit()

    def n(table: str) -> int:
        return r.q(f"select count(*) from erph.{table}")[0][0]

    KEPT = ["class", "subject", "audit_log", "school", "school_setting"]
    before = {t: n(t) for t in ["user", "school_member", "rph_document", "rph_revision",
                                "rph_review", "rph_template", "notification", "sync_op"] + KEPT}
    print("\nbefore:")
    for k, v in before.items():
        print(f"  {k:18} {v}")

    owners = r.q(
        "select u.username from erph.rph_document d join erph.user u on u.id = d.owner_id"
    )
    print(f"  document owner(s): {[o[0] for o in owners]}")

    # ── 1 · the guard must bite without app.purge ──────────────────────────
    try:
        r.q("delete from erph.rph_document")
        conn.commit()
        check("append-only guard blocks a bare delete", False, "it did not raise")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        check(
            "append-only guard blocks a bare delete",
            "tidak dibenarkan" in str(e),
            str(e).splitlines()[0][:80],
        )

    # ── 2 · the RESTRICT foreign keys must bite if order is wrong ──────────
    # rph_document.owner_id has no ON DELETE, so deleting accounts first would
    # fail. Prove that ordering is load-bearing rather than a style choice.
    try:
        r.q("delete from erph.user where role <> 'pentadbir'")
        conn.commit()
        check("deleting accounts first is refused", False, "it did not raise")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        check(
            "deleting accounts first is refused",
            "foreign key constraint" in str(e),
            str(e).splitlines()[0][:80],
        )

    # ── 3 · run the ops file exactly as a SQL editor would ─────────────────
    conn.autocommit = True
    wipe = (ROOT / "db" / "ops" / "wipe-except-pentadbir.sql").read_text(encoding="utf-8")
    try:
        with conn.cursor() as cur:
            cur.execute(wipe)
        check("wipe script executed", True)
    except Exception as e:  # noqa: BLE001
        check("wipe script executed", False, str(e).splitlines()[0][:170])

    after = {t: n(t) for t in before}
    print("\nafter:")
    for k, v in after.items():
        print(f"  {k:18} {v}")

    print("\nassertions:")
    check("exactly one account remains", after["user"] == 1)
    names = [x[0] for x in r.q("select username from erph.user")]
    check("the survivor is pentadbir.sk", names == ["pentadbir.sk"], str(names))
    check(
        "one membership remains",
        after["school_member"] == 1,
        f"{after['school_member']}",
    )
    check("no eRPH documents", after["rph_document"] == 0)
    check("no revisions (guard was lifted, cascade ran)", after["rph_revision"] == 0)
    check("no reviews (guard was lifted, cascade ran)", after["rph_review"] == 0)
    check("no templates", after["rph_template"] == 0)
    check("notifications and sync queue emptied",
          after["notification"] == 0 and after["sync_op"] == 0)
    for t in KEPT:
        check(f"{t} kept", after[t] == before[t], f"{before[t]} -> {after[t]}")
    check(
        "app.purge switched back off",
        r.q("select coalesce(current_setting('app.purge', true), 'unset')")[0][0] == "0",
        r.q("select coalesce(current_setting('app.purge', true), 'unset')")[0][0],
    )

    # ── 4 · re-running must be safe (nothing left to fail on) ──────────────
    try:
        with conn.cursor() as cur:
            cur.execute(wipe)
        check("re-running the wipe is safe", True)
    except Exception as e:  # noqa: BLE001
        check("re-running the wipe is safe", False, str(e).splitlines()[0][:170])

    print(f"\nRESULT: {FAILS} failure(s)")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
