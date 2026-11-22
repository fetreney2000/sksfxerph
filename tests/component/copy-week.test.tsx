// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { schoolDays } from "@/lib/date";
import { emptyPayload } from "@/lib/schemas/rph";
import type { RphDocument } from "@/lib/types";

type Candidate = { sourceId: string; planDate: string; weekNo: number };
const copy = vi.hoisted(() =>
  vi.fn(async (candidates: Candidate[], _session: string) =>
    candidates.map((candidate) => ({ sourceId: candidate.sourceId, ok: true, newId: "new-1" })),
  ),
);
vi.mock("@/lib/client/week-copy", () => ({ copyCandidatesToWeek: copy }));

vi.mock("@/lib/hooks/use-session", () => ({ useSession: () => "2026/2027" }));
vi.mock("@/lib/hooks/use-school-data", () => ({
  useSchoolClasses: () => ({
    items: [{ id: "c-a", nama: "5 Amanah", session: "2026/2027" }],
    loading: false,
  }),
}));

const SOURCE = schoolDays(9);
const DESTINATION = schoolDays(10);

vi.mock("@/lib/date", async (original) => ({
  ...(await original<typeof import("@/lib/date")>()),
  longDate: (iso: string) => iso,
  weekOptions: () => [
    { week: 10, monday: DESTINATION[0] ?? "", friday: DESTINATION[4] ?? "", label: "M10" },
    { week: 9, monday: SOURCE[0] ?? "", friday: SOURCE[4] ?? "", label: "M9" },
  ],
}));

const { CopyWeekDialog } = await import("@/components/rph/copy-week-dialog");

function plan(over: Partial<RphDocument> = {}): RphDocument {
  return {
    id: "p-1",
    schoolCode: "SK",
    ownerId: "teacher",
    classIds: ["c-a"],
    classNames: ["5 Amanah"],
    subjectCode: "MAT",
    subjectName: "Matematik",
    session: "2026/2027",
    weekNo: 9,
    planDate: SOURCE[0] ?? "",
    slotTime: "07:30",
    slotTimeEnd: "08:30",
    status: "approved",
    payload: { ...emptyPayload(), objektif: "O", refleksi: "R" },
    version: 1,
    clientUpdatedAt: 0,
    createdAt: 0,
    ...over,
  };
}

function mount(plans: RphDocument[], archive: RphDocument[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CopyWeekDialog
        open
        onOpenChange={() => undefined}
        sourceSession="2026/2027"
        sourceWeek={9}
        sourcePlans={plans}
        archive={archive}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  copy.mockClear();
});

describe("copy a week", () => {
  it("copies the clean plans and reports the result", async () => {
    mount([plan()], [plan()]);
    fireEvent.click(screen.getByRole("button", { name: /Salin 1 RPH/ }));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    const call = copy.mock.calls[0];
    expect(call?.[1]).toBe("2026/2027");
    expect(call?.[0]).toHaveLength(1);
    expect(call?.[0]?.[0]).toMatchObject({ planDate: DESTINATION[0], weekNo: 10 });
    await waitFor(() => expect(screen.getByText("1 disalin")).toBeTruthy());
  });

  it("blocks a plan that clashes with an existing destination plan", async () => {
    mount([plan()], [plan(), plan({ id: "p-2", weekNo: 10, planDate: DESTINATION[0] ?? "" })]);
    expect(screen.getByText(/Bertindih dengan RPH sedia ada/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Salin/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
