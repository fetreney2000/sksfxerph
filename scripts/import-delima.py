"""Turn a DELIMa staff export into an import script for the eRPH database.

    python scripts/import-delima.py <csv> [out.sql]

The CSV is the one Google Workspace for Education hands a school — the
"ID DELIMa, NAMA, JAWATAN" three columns, one row per staff member. This reads
it and writes a SQL file you run in the Supabase SQL editor.

Why a script rather than an insert: 66 people is 66 chances to mistype a name
by hand, and the file it writes is reviewable before it runs.

What it does, per row:

  username     the DELIMa id's local part — `g-15266597` from
               `g-15266597@moe-dl.edu.my`. Stable, unique, and it satisfies the
               username rule the app enforces, so nothing is renamed.
  email        the full DELIMa address. This is what makes the first Google
               sign-in *link* to the account rather than report an unknown
               user (erph.resolveAccount matches on `email` until `google_sub`
               is written by that first sign-in).
  role/jawatan read from JAWATAN. A Guru Besar becomes role `guru_besar`, the
               three Penolong Kanan offices become `gpk` with the matching
               `erph.jawatan`, and everything else is a Guru Biasa. An office
               the school's own system does not name is left NULL rather than
               guessed — the pentadbir sets it in /pentadbiran.

What it deliberately does not do: invent a password. Every account is imported
with a hash that can never verify, so the only way in is Google sign-in — and
the pentadbir can set a password for anyone from the accounts screen.

Safe to run twice: `on conflict … do nothing` means a second run leaves the
accounts exactly as they are, including any role or password the school has
since changed. Nothing is overwritten.

The output file is written next to the CSV, inside `download/`, which this
repository ignores: a staff roster is personal data and does not belong in a
public repo.
"""
from __future__ import annotations

import csv
import pathlib
import re
import sys

# erph.admin_create_member enforces this on every account the app creates, and
# erph.user_username_uniq enforces it on every row. Importing a name that
# fails it would produce an account nobody can sign in as.
USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")

# JAWATAN text → erph.jawatan. Anything not named here stays NULL: the school's
# system is the source of the office, and inventing one for a row it left blank
# is how a cover sheet ends up signed by an office nobody holds.
JAWATAN = {
    "GURU BESAR": "guru_besar",
    "GURU PENOLONG KANAN PENTADBIRAN": "pk_pentadbiran",
    "GURU PENOLONG KANAN HEM": "pk_hem",
    "GURU PENOLONG KANAN KOKUM": "pk_kokum",
    "GURU PENOLONG KANAN KOKURIKULUM": "pk_kokum",
    "GURU BIASA": "guru_biasa",
}

# …and the role that office may hold. Same table as JAWATAN_BY_ROLE in
# lib/types.ts, applied here so the two rows an account is written to —
# erph.user.role and erph.school_member.role — cannot disagree.
ROLE = {
    "guru_besar": "guru_besar",
    "pk_pentadbiran": "gpk",
    "pk_hem": "gpk",
    "pk_kokum": "gpk",
    "guru_biasa": "guru_biasa",
}

# A hash that verifies against nothing. The seed uses the same trick for the
# service account, and lib/server/auth/password fails closed on a value that is
# not a scrypt string — so this is "no password" rather than "a weak one".
NO_PASSWORD = "!imported-from-delima-no-password"


def q(value: str) -> str:
    """A SQL string literal, quotes doubled."""
    return "'" + value.replace("'", "''") + "'"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    src = pathlib.Path(sys.argv[1])
    out = (
        pathlib.Path(sys.argv[2])
        if len(sys.argv) > 2
        else src.with_name(f"import-{src.stem}.sql")
    )

    text = src.read_text(encoding="utf-8-sig")
    rows = list(csv.DictReader(text.splitlines()))

    seen: dict[str, str] = {}
    people: list[dict[str, str | None]] = []
    skipped: list[tuple[str, str]] = []

    for i, row in enumerate(rows, start=2):
        delima = (row.get("ID DELIMa") or "").strip().lower()
        name = (row.get("NAMA") or "").strip()
        jawatan_text = (row.get("JAWATAN") or "").strip()

        local = delima.split("@", 1)[0]
        if not delima or not name:
            skipped.append((f"baris {i}", "id atau nama kosong"))
            continue
        if "@" not in delima or not USERNAME_RE.match(local):
            skipped.append((local or f"baris {i}", "id DELIMa tidak boleh jadi nama pengguna"))
            continue
        if local in seen:
            # Two rows, one id: the second would silently never be created.
            skipped.append((local, f"berulang (nama pertama: {seen[local]})"))
            continue

        jawatan = JAWATAN.get(jawatan_text.upper())
        seen[local] = name
        people.append(
            {
                "username": local,
                "name": name,
                "email": delima,
                "jawatan": jawatan,
                "role": ROLE.get(jawatan, "guru_biasa"),
                "jawatan_text": jawatan_text or "(kosong)",
            }
        )

    if not people:
        print("Tiada baris boleh diimport — semak pengepala CSV.", file=sys.stderr)
        return 1

    usernames = ",\n      ".join(q(p["username"]) for p in people)

    def lit(p: dict[str, str | None], key: str) -> str:
        value = p[key]
        return q(value) if value else "null"

    body = f"""-- ============================================================================
-- eRPH ▸ IMPORT — staff from a DELIMa export ({len(people)} people)
-- ============================================================================
--
-- Generated by scripts/import-delima.py from {src.name}.
--
--   python scripts/import-delima.py "{src}"
--
-- Run in the Supabase SQL editor. Safe to run twice: an account that already
-- exists is left exactly as it is, so a role or password the school has since
-- changed is never overwritten.
--
-- No passwords are invented. Every account arrives with a hash that verifies
-- against nothing, so the only way in is Google sign-in with the school's own
-- @moe-dl.edu.my account — and the first sign-in links itself to the row by
-- email. The pentadbir can set a password for anyone from /pentadbiran.
--
-- Roles are read from JAWATAN: a Guru Besar is `guru_besar`, the three
-- Penolong Kanan offices are `gpk` with that office as their jawatan, and
-- everything else is a Guru Biasa. The pentadbir's own account is not touched.
-- ============================================================================

begin;

-- ── 1 · the accounts ────────────────────────────────────────────────────────
insert into erph.user (username, password_hash, full_name, email, google_email,
                       role, jawatan, is_active)
values
"""

    for p in people:
        body += (
            f"  ({q(p['username'])}, {q(NO_PASSWORD)}, {q(str(p['name']))}, "
            f"{q(str(p['email']))}, {q(str(p['email']))}, "
            f"{q(str(p['role']))}, {lit(p, 'jawatan')}, true),\n"
        )
    # f-string, so the second `{usernames}` below is interpolated too — the
    # first draft of this appended the tail as a plain string and printed the
    # placeholder into the SQL.
    body = body.rstrip(",\n") + f"""

-- The unique index is on lower(username), so that is the conflict target.
on conflict (lower(username)) do nothing;

-- ── 2 · the memberships ─────────────────────────────────────────────────────
-- The app is single-school, so "the school" is the one active row — the same
-- choice erph.resolveSchool makes. The role is written here as well as on the
-- account: erph.user.role is what the route guard reads and
-- school_member.role is what every SQL policy reads, and one without the
-- other is a half-granted account.
insert into erph.school_member (school_id, user_id, role)
select (select id from erph.school where is_active order by created_at limit 1),
       u.id, u.role
  from erph.user u
 where u.username in (
      {usernames}
 )
 on conflict do nothing;

commit;

-- ── 3 · what arrived ────────────────────────────────────────────────────────
select m.role::text as peranan,
       count(*) as bilangan
  from erph.school_member m
 group by 1
 order by 1;

select u.username, u.full_name, u.jawatan::text as jawatan, u.is_active
  from erph.user u
 where u.username in (
      {usernames}
 )
 order by u.full_name;
"""

    out.write_text(body, encoding="utf-8", newline="\n")
    print(f"{out} written — {len(people)} people, {len(skipped)} skipped")

    for where, why in skipped:
        print(f"  SKIP {where}: {why}", file=sys.stderr)
    for p in people:
        if p["jawatan"] is None:
            print(
                f"  note {p['username']}: JAWATAN \"{p['jawatan_text']}\" is not one of "
                f"the five offices — imported as Guru Biasa with no jawatan",
                file=sys.stderr,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
