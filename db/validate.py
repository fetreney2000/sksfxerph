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


# 2 · plpgsql body structure balance
funcs = re.findall(r"language plpgsql.*?as \$\$(.*?)\nend \$\$", SQL, re.S)
print(f"[2] plpgsql bodies: {len(funcs)}")
bad = 0
for i, b in enumerate(funcs):
    open_if = len(re.findall(r"(?<!end )(?<!els)if\s", b, re.I))
    end_if = len(re.findall(r"end\s+if", b, re.I))
    open_lp = len(re.findall(r"(?<!end )\bloop\b", b, re.I))
    end_lp = len(re.findall(r"end\s+loop", b, re.I))
    begins = len(re.findall(r"^\s*begin\s*$", b, re.M | re.I))
    end_blk = len(re.findall(r"^\s*end\s*;\s*$", b, re.M | re.I))
    exc_blk = len(re.findall(r"exception\s+when", b, re.I))
    ok = (
        open_if == end_if
        and open_lp == end_lp
        # inner blocks close with `end;`, the function body closes with `end $$`
        and end_blk == begins - 1
        # a handler may belong to the function-level block (no `end;` for it),
        # so exceptions can equal the number of begins, not just begins - 1
        and exc_blk <= begins
    )
    if not ok:
        bad += 1
        print(
            f"    body#{i}: MISMATCH if {open_if}/{end_if} loop {open_lp}/{end_lp} "
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
