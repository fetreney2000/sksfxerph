import re
import sys

from pglast import parse_sql
from pglast.parser import ParseError

SQL = open("db/schema.sql", encoding="utf-8").read()

# Objects in this file may be schema-qualified (`erph.school`) — accept both.
Q = r"(?:erph\.)?"


# 1 · full statement parse with the real PostgreSQL grammar
try:
    n = len(parse_sql(SQL))
    print(f"[1] PARSE OK - {n} statements")
except ParseError as e:
    print(f"[1] PARSE ERROR: {e}")
    sys.exit(1)


# 2 · function body balance, attributed by function name.
#
# Split per `create or replace function`, then take the body as everything
# between that function's `as $$` and the next `$$`. This handles BOTH body
# styles (`language sql` ends at `$$`, `language plpgsql` at `end $$`) — the
# earlier `as $$ … end $$` pairing swallowed SQL bodies into the next plpgsql
# function and reported a phantom imbalance.
funcs: list[tuple[str, str]] = []
starts = [m.start() for m in re.finditer(r"create or replace function\s+", SQL)]
for idx, st in enumerate(starts):
    stop = starts[idx + 1] if idx + 1 < len(starts) else len(SQL)
    chunk = SQL[st:stop]
    name_m = re.match(r"create or replace function\s+((?:erph\.)?\w+)", chunk)
    body_m = re.search(r"as \$\$(.*?)\$\$", chunk, re.S)
    if name_m and body_m:
        funcs.append((name_m.group(1).split(".")[-1], body_m.group(1)))

print(f"[2] function bodies: {len(funcs)}")
bad = 0
for name, b in funcs:
    # Strip `--` comments before counting: a comment mentioning "IF" or "loop"
    # is prose, not control flow (my own submit_rph comment caused a phantom
    # imbalance by saying "treats NULL in IF as false").
    code_lines = [
        ln.split("--", 1)[0]
        for ln in b.split("\n")
        if not ln.strip().startswith("--")
    ]
    c = "\n".join(code_lines)

    open_if = len(re.findall(r"(?<!end )(?<!els)if\s", c, re.I))
    end_if = len(re.findall(r"end\s+if", c, re.I))
    open_lp = len(re.findall(r"(?<!end )\bloop\b", c, re.I))
    end_lp = len(re.findall(r"end\s+loop", c, re.I))
    begins = len(re.findall(r"^\s*begin\s*$", c, re.M | re.I))
    end_blk = len(re.findall(r"^\s*end\s*;\s*$", c, re.M | re.I))
    exc_blk = len(re.findall(r"exception\s+when", c, re.I))

    ok = open_if == end_if and open_lp == end_lp
    if begins:
        # plpgsql body: inner blocks close with `end;`, the body closes with
        # `end $$`; a handler may belong to the function-level block.
        ok = ok and end_blk == begins - 1 and exc_blk <= begins
    # `language sql` bodies have no begin/end at all — the if/loop checks above
    # are all that apply (and trivially pass).

    if not ok:
        bad += 1
        print(
            f"    {name}: MISMATCH if {open_if}/{end_if} loop {open_lp}/{end_lp} "
            f"begin {begins} end; {end_blk} exc {exc_blk}"
        )
print(f"    -> {'all balanced' if bad == 0 else str(bad) + ' unbalanced'}")


# 3 · every function referenced in policies is defined
defined = set(re.findall(rf"create or replace function {Q}(\w+)", SQL))
called = set()
for m in re.findall(r"(?:using|with check)\s*\((.*?)\);", SQL, re.S):
    for fn in re.findall(r"([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", m):
        called.add(fn)
IGNORE = {
    "exists", "coalesce", "unnest", "trim", "lower", "nullif", "round",
    "count", "array_agg", "jsonb_build_object", "now", "gen_random_uuid",
    "to_tsvector", "split_part",
    "and", "or", "in", "check", "on", "using",
    "uid", "foldername",
}
missing = {
    c for c in called
    if c not in defined and c not in IGNORE and not c.startswith(("auth_", "storage_"))
}
print(f"[3] policy fn refs undefined: {sorted(missing) or 'none'}")


# 4 · RLS coverage: every table enabled, every policy target known
tables = set(re.findall(rf"create table {Q}(\w+)", SQL))
rls = set(re.findall(rf"alter table {Q}(\w+)\s+enable row level security", SQL))
policed = set(re.findall(r"create policy\s+\w+\s+on\s+([\w.]+)", SQL))
bare_policed = {p.split(".")[-1] for p in policed}
print(f"[4] tables={len(tables)} rls_enabled={len(rls)} policy_targets={len(policed)}")
print(f"    no RLS enabled: {sorted(tables - rls) or 'none'}")
print(f"    RLS on but no policy: {sorted(tables - bare_policed) or 'none'}")
# Every policy target must be either one of our tables (optionally qualified)
# or a Supabase-managed schema (storage.objects).
print(f"    policies on non-tables: {sorted(bare_policed - tables - {'objects'}) or 'none'}")
unexpected = [
    p for p in policed
    if p.split(".")[-1] not in tables and p.split(".")[0] != "storage"
]
print(f"    unexpected policy target: {unexpected or 'none'}")

# 5 · enum-array casts present in policies
uncast = re.findall(r"has_role\([^)]*array\[[^\]]*\]\s*\)", SQL)
print(f"[5] uncast enum arrays in policies: {len(uncast)}")

# 6 · orphan FK targets
refs = set(re.findall(rf"references {Q}(\w+)\s*\(", SQL))
print(f"[6] FK targets not defined: {sorted(refs - tables - {'users'}) or 'none'}")

# 7 · inventory
print(
    f"[7] indexes={len(re.findall(r'create (?:unique )?index', SQL))} "
    f"functions={len(defined)} "
    f"triggers={len(re.findall(r'create trigger', SQL))} "
    f"policies={len(re.findall(r'create policy', SQL))} "
    f"types={len(re.findall(r'^create type', SQL, re.M))} "
    f"grants={len(re.findall(r'grant |alter default privileges', SQL))}"
)

# 8 · schema-specific: our tables/views/types must all live in `erph`
# (triggers are matched on their `on <table>` clause — the token after
# `create trigger` is the trigger's *name*, not a table.)
stray_tables = re.findall(rf"create table\s+(?!erph\.)\w+", SQL)
stray_types = re.findall(rf"create type\s+(?!erph\.)\w+", SQL)
stray_views = re.findall(rf"create view\s+(?!erph\.)\w+", SQL)
stray_triggers = [
    m.group(1)
    for m in re.finditer(r"create trigger \w+.*?\bon\s+([\w.]+)", SQL, re.S)
    if m.group(1).split(".")[0] not in ("erph", "auth")
]
stray = stray_tables + stray_types + stray_views + stray_triggers
print(f"[8] objects created outside erph: {stray or 'none'}")
print(f"    schema declared: {'create schema if not exists erph' in SQL}")
print(f"    grants present:  {'grant usage on schema erph' in SQL}")

# 9 · the class of bug ONLY execution can catch — two halves, both of which
#    shipped once and were found by running the schema against real Postgres:
#
#    a) a type used unqualified in type position. `create type erph.member_role`
#       puts it in the erph schema, so bare `member_role` fails with 42704 at
#       runtime while still parsing fine. (A column that merely happens to be
#       *named* the same as a type is fine — that's what the leading-token
#       exception below allows.)
#    b) a schema qualifier leaked INTO a string literal during the bulk
#       qualification pass: enum values ('erph.school') and audit labels
#       ('erph.rph_document'). Valid SQL, wrong data, invisible to a parser.
TYPES = [
    "member_role",
    "rph_status",
    "curriculum",
    "template_visibility",
    "notification_type",
]

unqualified_types = []
for i, line in enumerate(SQL.split("\n"), 1):
    if line.lstrip().startswith("--"):
        continue
    code = line.split("--", 1)[0]
    # column-definition lines: <indent><name> <rest> — the leading name is a
    # column, never a type reference.
    m = re.match(r"\s+(\w+)(\s+)(\w+.*)$", code)
    body = code[m.end(1) :] if m else code
    for t in TYPES:
        if re.search(rf"(?<!erph\.)\b{t}\b", body):
            unqualified_types.append(f"L{i}: {line.strip()[:90]}")
            break

leaked_literals = []
for i, line in enumerate(SQL.split("\n"), 1):
    if line.lstrip().startswith("--"):
        continue
    for lit in re.findall(r"'([^']*)'", line):
        if "erph." in lit:
            leaked_literals.append(f"L{i}: {lit!r}")

print(f"[9] unqualified type refs: {unqualified_types or 'none'}")
print(f"    schema qualifiers inside string literals: {leaked_literals or 'none'}")
if unqualified_types or leaked_literals:
    print("    ^ these parse cleanly and fail only at execution — see scripts/run_schema.py")
