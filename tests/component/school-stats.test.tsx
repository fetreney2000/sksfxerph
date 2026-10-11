// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SchoolWeekPoint, useSchoolStats } from "@/lib/hooks/use-remote";

/**
 * The school's compliance figure, derived.
 *
 * This hook is where the 300% came from. It divided approved *plans* by the
 * teacher *headcount*, so a school of two with six approved plans between
 * them — a finished week — reported three hundred per cent, and a teacher who
 * finished their five for the week read as 500%. The database now sends both
 * the headcount and what the school actually owes (teachers × its own
 * RPH-per-week rule); these assert that the percentage uses the second and
 * the roster uses the first, and that it stops at 100.
 */

// The page gates on `supabaseConfigured`, which is false in this environment
// and would return the bundled demo figures instead of the rows below.
vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

const WEEK = 12;

function point(week: number, over: Partial<SchoolWeekPoint>): SchoolWeekPoint {
  return {
    week,
    teachers: 2,
    expected: 10, // two teachers × five RPH
    submitted: 10,
    approved: 10,
    returned: 0,
    compliance: 100,
    avgMinutes: null,
    ...over,
  };
}

/** `/api/stats` answers with the week card *and* the weeks behind it. */
function serve(rows: SchoolWeekPoint[]) {
  const body = {
    stats: {
      teachers: rows[0]?.teachers ?? 0,
      expected: rows[0]?.expected ?? 0,
      submitted: rows[0]?.submitted ?? 0,
      approved: rows[0]?.approved ?? 0,
      returned_t: rows[0]?.returned ?? 0,
      drafts: 0,
      compliance: rows[0]?.compliance ?? 0,
    },
    history: rows,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

function Probe({ first, last }: { first: number; last: number }) {
  const s = useSchoolStats({ first, last });
  return (
    <dl>
      <dt>guru</dt>
      <dd data-testid="teachers">{s.activeTeachers}</dd>
      <dt>dijangka</dt>
      <dd data-testid="expected">{s.expected}</dd>
      <dt>pematuhan</dt>
      {/* "—" for the null rate: a school with no denominator, or figures
          that have not been measured, is not scored zero. */}
      <dd data-testid="pct">{s.compliancePct === null ? "—" : s.compliancePct}</dd>
    </dl>
  );
}

async function mount(
  pct: string,
  window: { first: number; last: number } = { first: WEEK, last: WEEK },
) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <Probe first={window.first} last={window.last} />
    </QueryClientProvider>,
  );
  // The first render is the local-mode fallback (the bundled demo figures) —
  // waiting for the *value* rather than for "something" is what makes this
  // test notice the rows arriving at all.
  await waitFor(() => expect(screen.getByTestId("pct").textContent).toBe(pct));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("school compliance", () => {
  it("measures approved plans against what the school owes, not its headcount", async () => {
    // Two teachers, five RPH each: the school owes ten. Six approved plans is
    // 60% of that — the figure that used to read as 300%.
    serve([point(WEEK, { approved: 6, submitted: 7, returned: 1, compliance: 60 })]);
    await mount("60");

    expect(screen.getByTestId("teachers").textContent).toBe("2");
    expect(screen.getByTestId("expected").textContent).toBe("10");
  });

  it("stops at 100 when a week hands in more than it owes", async () => {
    // One plan per class can easily beat the weekly minimum. That has met the
    // requirement, not exceeded it — and the counts on the same card still
    // say how many were approved.
    serve([point(WEEK, { submitted: 14, approved: 14, compliance: 100 })]);
    await mount("100");
  });

  it("spreads a wider window over the weeks in it", async () => {
    // Two full weeks: twenty approved of twenty owed. Same rule, more of it.
    serve([point(WEEK - 1, {}), point(WEEK, {})]);
    await mount("100", { first: WEEK - 1, last: WEEK });

    // The window's expectation is every week's in it, so the card can state
    // a total the percentage can be checked against.
    expect(screen.getByTestId("expected").textContent).toBe("20");
  });

  it("is not scored at all when a school has no teachers", async () => {
    // No active Guru Biasa means no denominator — and `least(100, NULL)` is
    // 100 in Postgres, so the SQL guards this explicitly. The view gets a
    // dash, not a zero and not a perfect score.
    serve([
      point(WEEK, { teachers: 0, expected: 0, submitted: 0, approved: 0, compliance: null }),
    ]);
    await mount("—");

    expect(screen.getByTestId("teachers").textContent).toBe("0");
  });
});
