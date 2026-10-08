"""Contract check, take 2: handle `"..."\n + "..."` concatenation and validate
embedded relations too. Also audit that every /api route is either guarded or
explicitly public.
"""
import pathlib
import re

sql = pathlib.Path("db/schema.sql").read_text(encoding="utf-8")

TABLES: dict[str, set[str]] = {}
FKS: dict[str, dict[str, str]] = {}
for m in re.finditer(r"create table erph\.(\w+) \((.*?)\n\);", sql, re.S):
    name, body = m.group(1), m.group(2)
    TABLES[name] = set(re.findall(r"^\s{2}(\w+)\s", body, re.M))
    for line in body.split("\n"):
        col = re.match(r"\s{2}(\w+)\s", line)
        ref = re.search(r"references erph\.(\w+)\(", line)
        if col and ref:
            FKS.setdefault(name, {})[col.group(1)] = ref.group(1)

problems = 0

for f in sorted(pathlib.Path("app/api").rglob("route.ts")):
    src = f.read_text(encoding="utf-8")

    # join adjacent string literals so a concatenated .select() is visible
    flat = re.sub(r'"\s*\+\s*\n\s*"', "", src)

    for m in re.finditer(r'\.select\(\s*"([^"]+)"', flat):
        spec = m.group(1)
        before = flat[: m.start()]
        froms = re.findall(r'\.from\("(\w+)"\)', before)
        table = froms[-1] if froms else None
        if table not in TABLES:
            continue
        for part in [p.strip() for p in spec.split(",") if p.strip()]:
            embed = re.match(r"\w+:(\w+)\(([\w, ]+)\)", part)
            if embed:
                fk, cols = embed.group(1), embed.group(2)
                target = FKS.get(table, {}).get(fk)
                if target is None:
                    print(f"  BUG {f}: embed {fk!r} is not an FK of erph.{table}")
                    problems += 1
                    continue
                for c in [c.strip() for c in cols.split(",")]:
                    if c not in TABLES.get(target, set()):
                        print(f"  BUG {f}: erph.{target}.{c} does not exist")
                        problems += 1
            elif part not in TABLES[table]:
                print(f"  BUG {f}: erph.{table}.{part} does not exist (select {part!r})")
                problems += 1

    for m in re.finditer(r'\.rpc\("(\w+)"\s*,\s*\{([^}]*)\}', flat, re.S):
        fn, args = m.group(1), m.group(2)
        sig = re.search(
            r"create or replace function erph\." + fn + r"\((.*?)\)\s*returns", sql, re.S
        )
        if not sig:
            print(f"  BUG {f}: erph.{fn}() is not defined")
            problems += 1
            continue
        params = set(re.findall(r"(p_\w+)\s", sig.group(1)))
        passed = set(re.findall(r"(p_\w+)\s*:", args))
        if passed - params:
            print(f"  BUG {f}: {fn}() unknown params {sorted(passed - params)}")
            problems += 1
        if params - passed:
            print(f"  WARN {f}: {fn}() params not supplied: {sorted(params - passed)}")

    # ---- route guard audit ----
    rel = str(f).replace("\\", "/")
    is_public = any(
        k in rel for k in ("auth/login", "auth/logout", "auth/me", "heartbeat")
    )
    guarded = any(
        g in src
        for g in ("requireUser(", "requireDbUser(", "requireReviewer(", "requireAdministrator(")
    )
    if is_public:
        label = "public (intended)"
    elif guarded:
        label = "guarded"
    else:
        label = "BUG: UNPROTECTED"
        problems += 1
    print(f"  [{label:>20}] {rel}")

print()
print("RESULT:", "all contracts + guards OK" if problems == 0 else f"{problems} problem(s)")
