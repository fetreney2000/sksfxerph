// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserProvider } from "@/components/shell/user-context";
import type { QueueItem } from "@/lib/demo/review";
import type { ReviewPlanLight, SchoolStatsView } from "@/lib/hooks/use-remote";
import { emptyPayload } from "@/lib/schemas/rph";

/**
 * The review queue, rendered - the Belum disemak / Semua tabs.
 *
 * The server side of the queue is proved in `tests/unit/queue-week.test.ts`;
 * what that cannot see is the page's own filter, which is pure client state:
 * `graded` (this sitting's decisions) hides a row from Belum disemak, and the
 * Semua tab keeps it listed with the recorded badge. A regression here would
 * be silent - a reviewer working down a queue that forgets what they decided
 * re-decides plans, and one that shows them twice grades them twice.
 */

const state = vi.hoisted(() => ({
  queue: [] as QueueItem[],
  plans: [] as ReviewPlanLight[],
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

vi.mock("@/lib/hooks/use-remote", () => ({
  useReviewQueueData: () => ({
    items: state.queue,
    loading: false,
    total: state.queue.length,
    hasMore: false,
    loadingMore: false,
    loadMore: () => {},
  }),
  useReviewPlans: () => ({
    items: state.plans,
    loading: false,
    assigned: true,
    refetch: async () => undefined,
  }),
  useSchoolStats: (): SchoolStatsView => ({
    activeTeachers: 2,
    expected: 10,
    submitted: 2,
    approved: 0,
    returned: 0,
    compliancePct: null,
    avgMinutes: null,
    prevAvgMinutes: null,
    weeks: [],
    loading: false,
  }),
}));

// The decision RPC: resolved instantly, so a press records the grade and the
// screen advances without any server in the way.
vi.mock("@/lib/signature/review", () => ({ decide: vi.fn(async () => undefined) }));

const { default: SemakanPage } = await import("@/app/(app)/(semak)/semakan/page");

const approveBtn = () => screen.getByRole("button", { name: /^Sahkan/ });
const row = (teacher: string) => screen.getByRole("button", { name: new RegExp(teacher) });
// Radix switches tabs on mousedown, not click - fireEvent.click alone never
// moves the segmented control.
const pickTab = (name: string) => {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
};

beforeAll(() => {
  // jsdom has none; the leaf rows ask it to decide desktop vs phone on click.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false } as MediaQueryList),
  });
});

beforeEach(() => {
  state.queue = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      version: 1,
      teacherName: "Ali bin Abu",
      initials: "AA",
      tone: "blue",
      className: "5 Amanah",
      subjectName: "Matematik",
      planDate: "2020-11-16",
      slotTime: "07:30",
      status: "submitted",
      ageLabel: "Hari ini",
      payload: emptyPayload(),
    },
    {
      id: "22222222-2222-4111-8222-222222222222",
      version: 1,
      teacherName: "Cik Siti",
      initials: "CS",
      tone: "blue",
      className: "6 Bakti",
      subjectName: "Bahasa Melayu",
      planDate: "2020-11-17",
      slotTime: "09:00",
      status: "submitted",
      ageLabel: "1 hari menunggu",
      payload: emptyPayload(),
    },
  ] as QueueItem[];
  state.plans = [];
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  // Put jsdom back the way it was for any test file that runs after this one.
  Reflect.deleteProperty(window, "matchMedia");
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <UserProvider user={{ id: "gpk-1", fullName: "GPK Semakan", role: "gpk" }}>
        <SemakanPage />
      </UserProvider>
    </QueryClientProvider>,
  );
}

describe("Semakan queue - Belum disemak / Semua filter", () => {
  it("opens on Belum disemak with both rows and matching counts", () => {
    renderPage();

    expect(screen.getByRole("tab", { name: "Belum disemak (2)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Semua (2)" })).toBeTruthy();
    // The work-list node's badge and aria-label count what the tab lists.
    expect(screen.getByRole("button", { name: "Menunggu semakan, 2 RPH" })).toBeTruthy();
    expect(row("Ali · 5 Amanah")).toBeTruthy();
    expect(row("Cik · 6 Bakti")).toBeTruthy();
  });

  it("hides a decided row from Belum disemak and keeps it under Semua with its badge", async () => {
    renderPage();

    // The first row is selected automatically; decide it.
    fireEvent.click(approveBtn());

    // Belum disemak loses the row, and both counts follow.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Ali · 5 Amanah/ })).toBeNull(),
    );
    expect(screen.getByRole("tab", { name: "Belum disemak (1)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Semua (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Menunggu semakan, 1 RPH" })).toBeTruthy();

    // Semua keeps the row, wearing the recorded decision, not "Baru".
    pickTab("Semua (2)");
    const decided = row("Ali · 5 Amanah");
    expect(decided).toBeTruthy();
    expect(within(decided).getByText("Lengkap")).toBeTruthy();
    expect(within(row("Cik · 6 Bakti")).getByText("Baru")).toBeTruthy();

    // Back to Belum disemak: the decided row stays gone.
    pickTab("Belum disemak (1)");
    expect(screen.queryByRole("button", { name: /Ali · 5 Amanah/ })).toBeNull();
    expect(row("Cik · 6 Bakti")).toBeTruthy();
  });

  it("shows the empty state when every queued plan has been decided", async () => {
    renderPage();

    fireEvent.click(approveBtn());
    await waitFor(() => screen.getByRole("tab", { name: "Belum disemak (1)" }));
    fireEvent.click(approveBtn());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Cik · 6 Bakti/ })).toBeNull(),
    );

    expect(screen.getByText("Semua RPH sudah disemak. 👍")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Menunggu semakan, 0 RPH" })).toBeTruthy();
  });

  it("re-opening a decided row from Semua is view-only, not decidable again", async () => {
    renderPage();

    fireEvent.click(approveBtn());
    await waitFor(() => screen.getByRole("tab", { name: "Belum disemak (1)" }));
    pickTab("Semua (2)");
    fireEvent.click(row("Ali · 5 Amanah"));

    await waitFor(() =>
      expect(screen.getByText("RPH ini sudah diputuskan - paparan sahaja.")).toBeTruthy(),
    );
    // The decision buttons are gone - the queue row still says "submitted"
    // (it was fetched before the decision), but the recorded grade closes it.
    expect(screen.queryByRole("button", { name: /^Sahkan/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Kembalikan/ })).toBeNull();
  });
});
