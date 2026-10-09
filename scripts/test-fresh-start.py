"""Prove db/ops/fresh-start.sql does what it claims.

The fresh-start script is destructive and irreversible, so it is not allowed to
be something nobody has run. This harness builds the shape the seed creates —
five accounts, classes, subjects, an eRPH with revisions and a review — sets
school identity values worth protecting, and then

  1. confirms the append-only guard actually blocks a bare delete, and that
     deleting the accounts *first* is refused by rph_document.owner_id, so the
     ordering in that file is load-bearing rather than a style choice;
  2. runs the script as one multi-statement string, the way a SQL editor sends
     it;
  3. asserts exactly one account survives *and it is now called `pentadbir`*,
     that classes/subjects/eRPH/templates/history are all empty, that the
     school row and school_setting came through untouched, and that app.purge
     is switched back off;
  4. runs it a second time to prove re-running is safe.

  python scripts/test-fresh-start.py
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import run_schema as rs  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
FAILS = 0

# Values set on the school before the wipe, chosen to be nothing like the seed
# defaults — if the script touched this row, these are what would go missing.
KEPT_SCHOOL = {
    "kod_sekolah": "XCA1043",
    "nama": "SK St. Francis Xavier Keningau",
    "ppd": "PPD Keningau",
    "jpn": "JPN Sabah",
    "motto": "Bersatu Kita Teguh",
    "logo_url": "/uploads/crest-ujian.png",
}
KEPT_SETTING = {"current_session": "2031/2032", "submit_time": "15:30:00"}


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
        # pg_trgm; Supabase does. The trigram index is not load-bearing here.
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
    # …and identity worth protecting, deliberately unlike the seed defaults.
    r.q(
        f"""
        update erph.school
           set kod_sekolah = '{KEPT_SCHOOL["kod_sekolah"]}',
               nama        = '{KEPT_SCHOOL["nama"]}',
               ppd         = '{KEPT_SCHOOL["ppd"]}',
               jpn         = '{KEPT_SCHOOL["jpn"]}',
               motto       = '{KEPT_SCHOOL["motto"]}',
               logo_url    = '{KEPT_SCHOOL["logo_url"]}';
        update erph.school_setting
           set current_session = '{KEPT_SETTING["current_session"]}',
               submit_time     = '{KEPT_SETTING["submit_time"]}';
        """
    )
    conn.commit()

    def n(table: str) -> int:
        return r.q(f"select count(*) from erph.{table}")[0][0]

    CLEARED = [
        "class", "subject", "rph_document", "rph_revision",
        "rph_review", "rph_template", "notification", "sync_op", "audit_log",
        "export_file", "dskp_standard", "academic_calendar", "teaching_assignment",
    ]
    before = {
        "user": n("user"),
        "school_member": n("school_member"),
        **{t: n(t) for t in CLEARED},
    }
    print("\nbefore:")
    for k, v in before.items():
        print(f"  {k:22} {v}")
    print(f"  school code             {r.q('select kod_sekolah from erph.school')[0][0]}")
    print(f"  usernames               {[x[0] for x in r.q('select username from erph.user order by 1')]}")

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

    # ── 2 · ordering must bite if accounts go first ────────────────────────
    # rph_document.owner_id has no ON DELETE, so this has to fail. Without it
    # the ordering comments in the script would be an untested claim.
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

    # ── 3 · subjects-before-DSKP must also bite ─────────────────────────────
    r.q(
        """
        insert into erph.dskp_standard (dskp_version, curriculum, subject_code, tahap,
                                        kod_sk, standard_kandungan, kod_sp, standard_pembelajaran)
        select 2026, 'KSSR', code, 'Tahun 5', '3.1', 'Ujian SK', '3.1.1', 'Ujian SP'
          from erph.subject limit 1;
        """
    )
    conn.commit()
    try:
        r.q("delete from erph.subject")
        conn.commit()
        check("deleting subjects with DSKP present is refused", False, "it did not raise")
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        check(
            "deleting subjects with DSKP present is refused",
            "foreign key constraint" in str(e),
            str(e).splitlines()[0][:80],
        )

    # ── 4 · run the ops file exactly as a SQL editor would ─────────────────
    conn.autocommit = True
    wipe = (ROOT / "db" / "ops" / "fresh-start.sql").read_text(encoding="utf-8")
    try:
        with conn.cursor() as cur:
            cur.execute(wipe)
        check("fresh-start script executed", True)
    except Exception as e:  # noqa: BLE001
        check("fresh-start script executed", False, str(e).splitlines()[0][:170])

    after = {
        "user": n("user"),
        "school_member": n("school_member"),
        **{t: n(t) for t in CLEARED},
    }
    print("\nafter:")
    for k, v in after.items():
        print(f"  {k:22} {v}")

    print("\nassertions — cleared:")
    check("exactly one account remains", after["user"] == 1, f"{after['user']}")
    for t in CLEARED:
        check(f"{t} emptied", after[t] == 0, f"{before[t]} -> {after[t]}")
    # school_member is deliberately NOT in that list: the Administrator's own
    # row must survive or they lose access to the very school they kept. Only
    # the other three cascade away with their users.
    check(
        "only the Administrator's membership remains",
        after["school_member"] == 1 and before["school_member"] > 1,
        f"{before['school_member']} -> {after['school_member']}",
    )

    print("\nassertions — the account you keep:")
    row = r.q("select username, role, is_active from erph.user")[0]
    check("renamed to pentadbir", row[0] == "pentadbir", str(row))
    check("still the pentadbir role", row[1] == "pentadbir", str(row[1]))
    check("still active", row[2] is True, str(row[2]))
    # The password is untouched — this is a rename, not a replacement.
    same = r.q(
        "select count(*) from erph.user where username = 'pentadbir' "
        "and password_hash is not null and length(password_hash) > 10"
    )[0][0]
    check("password_hash survives the rename", same == 1, str(same))
    check(
        "its membership survives",
        r.q(
            "select count(*) from erph.school_member m join erph.user u on u.id = m.user_id "
            "where u.username = 'pentadbir'"
        )[0][0]
        == 1,
    )

    print("\nassertions — school info kept:")
    school = dict(
        zip(
            KEPT_SCHOOL,
            r.q(
                "select kod_sekolah, nama, ppd, jpn, motto, logo_url from erph.school"
            )[0],
        )
    )
    check("school row untouched", school == KEPT_SCHOOL, str(school))
    # `submit_time` comes back as datetime.time, not text — compare as text so
    # the check is about the value, not the driver's type mapping.
    session_value = r.q("select current_session from erph.school_setting")[0][0]
    submit_value = str(r.q("select submit_time from erph.school_setting")[0][0])
    setting = {"current_session": session_value, "submit_time": submit_value}
    check("school_setting untouched", setting == KEPT_SETTING, str(setting))

    print("\nassertions — hygiene:")
    check(
        "app.purge switched back off",
        r.q("select coalesce(current_setting('app.purge', true), 'unset')")[0][0] == "0",
        r.q("select coalesce(current_setting('app.purge', true), 'unset')")[0][0],
    )

    # ── 5 · re-running must be safe ────────────────────────────────────────
    try:
        with conn.cursor() as cur:
            cur.execute(wipe)
        check("re-running is safe", True)
        check(
            "and does not rename anything away",
            r.q("select username from erph.user")[0][0] == "pentadbir",
        )
    except Exception as e:  # noqa: BLE001
        check("re-running is safe", False, str(e).splitlines()[0][:170])

    print(f"\nRESULT: {FAILS} failure(s)")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
