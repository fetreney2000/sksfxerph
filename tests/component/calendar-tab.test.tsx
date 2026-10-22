// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarTab } from "@/components/admin/calendar-tab";
import { currentWeek, setCalendarAnchors } from "@/lib/config";
import { schoolDays } from "@/lib/date";

/**
 * Kalendar minggu, rendered.
 *
 * The tab's whole job is to let a school say "this range is week 34" and to be
 * honest about what that does to the weeks after it, so what is pinned here is
 * that it shows the app's own numbering rather than a parallel one, that a
 * declaration actually reaches the endpoint, and — the one a person would most
 * easily get wrong — that a Monday that is not a Monday is refused *in words*
 * rather than by a button that simply will not press.
 *
 * The database refuses the same thing again, and `run_schema.py` proves that.
 * This is the surface.
 */

/** Anchored on the current week so the assertions do not depend on today. */
const WEEK = currentWeek();
const MONDAY = schoolDays(WEEK)[0] ?? "";
const FRIDAY = schoolDays(WEEK)[4] ?? "";
const NEXT_MONDAY = schoolDays(WEEK + 1)[0] ?? "";
const NEXT_TUESDAY = schoolDays(WEEK + 1)[1] ?? "";

const DECLARED = {
  session: "2026/2027",
  week_no: WEEK,
  start_date: MONDAY,
  end_date: FRIDAY,
  label: "Minggu PTS",
};

interface Call {
  url: string;
  method: string;
  body: string;
}
const calls: Call[] = [];

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = (init?.method ?? "GET").toUpperCase();
  calls.push({ url, method, body: typeof init?.body === "string" ? init.body : "" });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  if (method === "GET") return json({ anchors: [DECLARED], session: "2026/2027" });
  return json({ ok: true });
}

const patchCalls = () => calls.filter((c) => c.method === "PATCH");

beforeEach(() => {
  // jsdom does not implement it; browsers all do. Picking a row scrolls the
  // form into view, and without the stub that throws out of the click handler.
  Element.prototype.scrollIntoView = vi.fn();
  // The week picker is built from the store, which providers populate in the
  // real app and no test does here — so the declared week has to be in it for
  // the row to exist at all.
  setCalendarAnchors([{ weekNo: WEEK, startDate: MONDAY, label: "Minggu PTS" }]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  calls.length = 0;
  setCalendarAnchors([]);
});

async function mount() {
  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <CalendarTab />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("Ditetapkan pentadbir")).toBeTruthy());
  return view;
}

describe("kalendar minggu", () => {
  it("shows the app's own numbering, and where each number came from", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    // The declared week…
    expect(screen.getByText("Ditetapkan pentadbir")).toBeTruthy();
    expect(screen.getByText(/Minggu PTS/)).toBeTruthy();
    // …and at least one still on the term-start grid.
    expect(screen.getAllByText("Automatik").length).toBeGreaterThan(1);
  });

  it("prefills the form from a row on the grid", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    const buttons = screen.getAllByRole("button", { name: "Tetapkan" });
    fireEvent.click(buttons[0] as HTMLElement);

    const date = screen.getByLabelText(/Tarikh mula/) as HTMLInputElement;
    const week = screen.getByLabelText(/Nombor minggu/) as HTMLInputElement;
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(week.value)).toBeGreaterThanOrEqual(1);
    // The Monday it will send: seven days before is the previous week's, so the
    // date has to be one of the five the picker itself offers.
    expect(schoolDays(Number(week.value)).slice(0, 5)).toContain(date.value);
  });

  it("sends an edit as the row it replaces, not as a second declaration", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    // The declared week's own handle: this is an edit of the row already there.
    fireEvent.click(screen.getByRole("button", { name: "Sunting" }));
    fireEvent.click(screen.getByRole("button", { name: /Simpan perubahan/ }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse((patchCalls()[0] as Call).body) as Record<string, unknown>;
    expect(body).toMatchObject({
      weekNo: WEEK,
      startDate: MONDAY,
      endDate: FRIDAY,
      label: "Minggu PTS",
      fromWeekNo: WEEK,
    });
  });

  it("refuses a date that is not a Monday, in words, without sending it", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    fireEvent.change(screen.getByLabelText(/Tarikh mula/), {
      target: { value: NEXT_TUESDAY },
    });
    fireEvent.change(screen.getByLabelText(/Nombor minggu/), {
      target: { value: String(WEEK + 1) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Tetapkan minggu/ }));

    expect(await screen.findByText(/mesti hari Isnin/)).toBeTruthy();
    expect(patchCalls()).toEqual([]);
  });

  it("hands a declared week back to the automatic assignment", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    fireEvent.click(screen.getByRole("button", { name: /Automatik/ }));

    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    const call = calls.find((c) => c.method === "DELETE") as Call;
    expect(call.url).toContain(`weekNo=${WEEK}`);
  });

  it("previews the weeks a declaration will renumber before it saves", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    // The current week is already declared at this Monday, so re-declaring it
    // under a new number should list the weeks that follow it.
    fireEvent.change(screen.getByLabelText(/Tarikh mula/), { target: { value: NEXT_MONDAY } });
    fireEvent.change(screen.getByLabelText(/Nombor minggu/), {
      target: { value: String(WEEK + 5) },
    });

    await screen.findByText(/Selepas disimpan/);
    expect(screen.getByText(new RegExp(`M${WEEK + 5}`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`M${WEEK + 6}`))).toBeTruthy();
    expect(patchCalls()).toEqual([]);
  });
});
