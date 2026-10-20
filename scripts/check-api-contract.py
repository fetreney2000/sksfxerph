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

# The only endpoints that are meant to answer without a session.
#
# Exact paths, not substrings: the old check was `any(k in rel for k in ...)`,
# so a future `app/api/auth/members/route.ts` would have been classified
# public because its path contains "auth/". The list is a decision about
# these five routes and nothing else.
PUBLIC_ROUTES = {
    "app/api/auth/login/route.ts",
    "app/api/auth/logout/route.ts",
    "app/api/auth/me/route.ts",
    "app/api/auth/google/route.ts",
    "app/api/heartbeat/route.ts",
}

GUARDS = (
    "requireUser(",
    "requireDbUser(",
    "requireReviewer(",
    "requireAdministrator(",
    "requirePermission(",
)

# A call that reaches for the database. The guard has to come first.
DATA_ACCESS = (
    ".from(",
    ".rpc(",
    "adminDb(",
)

HTTP_METHODS = ("GET", "POST", "PATCH", "PUT", "DELETE")

# A top-level function declaration, exported or not.
FN = re.compile(r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(", re.M)


def top_level_functions(src: str) -> list[tuple[str, str, bool]]:
    """(name, body, is_exported) for every top-level function in the file.

    Cut on the next top-level declaration, so a handler's body stops where
    the next function begins — otherwise the GET handler of a file would
    swallow the local helper that follows it and appear to contain its guard.
    """
    matches = list(FN.finditer(src))
    out: list[tuple[str, str, bool]] = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(src)
        exported = src[m.start() : m.end()].startswith("export")
        out.append((m.group(1), src[m.start() : end], exported))
    return out


def handlers_in(src: str) -> list[tuple[str, str]]:
    """Every exported HTTP handler in a route file, with its body."""
    return [
        (name, body)
        for name, body, exported in top_level_functions(src)
        if exported and name in HTTP_METHODS
    ]


def local_functions(src: str) -> dict[str, str]:
    """Every function declared in this file, by name — the ones a handler may
    reach its guard through."""
    return {name: body for name, body, _ in top_level_functions(src)}


def has_guard(body: str) -> bool:
    """Does this body call a guard directly?

    A call, not an import: `requireUser(` with the parenthesis is the call.
    """
    return any(g in body for g in GUARDS)


def guards_properly(body: str) -> bool:
    """Is the guard called *before* the first reach for data?

    A guard that runs after the first query protects nothing: the query has
    already gone out by then.
    """
    guard_at = min((body.find(g) for g in GUARDS if g in body), default=-1)
    data_at = min((body.find(d) for d in DATA_ACCESS if d in body), default=-1)
    if guard_at < 0 or data_at < 0:
        return guard_at >= 0
    return guard_at < data_at


def guarding_helpers(src: str) -> set[str]:
    """The local functions that themselves guard, properly.

    A route is allowed to reach its guard through one of these —
    `adminGate(request)` and `canEdit(request, id)` are the two in this
    codebase — so the checker follows the call rather than demanding that
    every handler spell the guard out itself.
    """
    return {
        name
        for name, body in local_functions(src).items()
        if name not in HTTP_METHODS and has_guard(body) and guards_properly(body)
    }


def guard_points(body: str, helpers: set[str]) -> list[int]:
    """Where in this body a guard is reached — directly, or through a helper."""
    points = [body.find(g) for g in GUARDS if g in body]
    for name in helpers:
        # The call site, not the definition — the definition is in another body.
        for m in re.finditer(r"(?<![.\w])" + re.escape(name) + r"\s*\(", body):
            points.append(m.start())
    return points


def first_data_access(body: str) -> int:
    return min((body.find(d) for d in DATA_ACCESS if d in body), default=-1)


def select_parts(spec: str) -> list[str]:
    """Split a PostgREST select on its *top-level* commas.

    An embedded relation carries its own list — `signer:signer_id(full_name,
    jawatan)` — and splitting that on every comma turns it into two bogus
    column names, each of which then "does not exist".
    """
    parts: list[str] = []
    depth, current = 0, []
    for ch in spec:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    if current:
        parts.append("".join(current))
    return [p.strip() for p in parts if p.strip()]

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
        for part in select_parts(spec):
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
    #
    # Per *handler*, not per file. A file with a guarded GET and an unguarded
    # POST used to read as guarded, because the check was "does this file
    # mention a guard anywhere" — so the one property the script claims to
    # verify was the one thing it could not verify.
    #
    # Each exported method is cut out of the source and checked on its own:
    # it must call a guard, and it must do so *before* it touches a table.
    rel = str(f).replace("\\", "/")
    is_public = rel in PUBLIC_ROUTES
    handlers = handlers_in(src)
    helpers = guarding_helpers(src)

    if not handlers:
        print(f"  [BUG: NO HANDLER  ] {rel}")
        problems += 1
    for method, body in handlers:
        label = f"{rel} {method}"
        if is_public:
            print(f"  [{'public (intended)':>20}] {label}")
            continue
        points = guard_points(body, helpers)
        if not points:
            print(f"  [BUG: UNPROTECTED] {label}")
            problems += 1
            continue
        data_at = first_data_access(body)
        if data_at >= 0 and min(points) > data_at:
            print(f"  [BUG: TOO LATE    ] {label} — data is read before the guard")
            problems += 1
            continue
        print(f"  [{'guarded':>20}] {label}")

print()
print("RESULT:", "all contracts + guards OK" if problems == 0 else f"{problems} problem(s)")
