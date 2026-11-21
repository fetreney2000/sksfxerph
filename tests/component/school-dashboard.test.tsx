// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  supabaseConfigured: true,
}));
vi.mock("@/lib/hooks/use-calendar", () => ({ useCurrentWeek: () => 8 }));
vi.mock("@/lib/hooks/use-session", () => ({ useSession: () => "2026/2027" }));
vi.mock("@/lib/hooks/use-remote", () => ({
  useSchoolStats: () => ({
    activeTeachers: 4,
    submitted: 7,
    approved: 3,
    expected: 20,
    compliancePct: 15,
    avgMinutes: 30,
    weeks: [{ week: 8, compliance: 15 }],
    loading: false,
    error: false,
  }),
}));

const { default: SekolahPage } = await import("@/app/(app)/(pantau)/sekolah/page");
const teacher = (name: string, weekTotal: number, weekDone: number) => ({
  userId: name,
  fullName: name,
  role: "guru_biasa",
  classes: null,
  weekTotal,
  weekDone,
  sessionTotal: weekTotal,
  sessionDone: weekDone,
  returnedTotal: 0,
  fixedTotal: 0,
  lastReviewedAt: null,
  rptLinks: [],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("school dashboard", () => {
  it("counts each recorded-plan approval state without calling unapproved work late", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                teacher("Semua", 3, 3),
                teacher("Sebahagian", 3, 1),
                teacher("Belum", 3, 0),
                teacher("Kosong", 0, 0),
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SekolahPage />
      </QueryClientProvider>,
    );
    await screen.findByText("Kosong");
    expect(screen.getByText("RPH bukan draf")).toBeTruthy();
    expect(screen.getByText("3 disahkan / 20 sasaran · maksimum 100%")).toBeTruthy();
    expect(screen.getByText("Tiada RPH")).toBeTruthy();
    expect(screen.queryByText("Lewat")).toBeNull();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Sebahagian disahkan")).toBeTruthy();
    expect(within(table).getByText("Belum disahkan")).toBeTruthy();
    for (const label of [
      "Semua RPH disahkan",
      "Sebahagian disahkan",
      "Belum ada yang disahkan",
      "Tiada RPH direkodkan",
    ]) {
      const row = screen
        .getAllByText(label)
        .find((element) => element.parentElement?.textContent === `${label}1`);
      expect(row).toBeTruthy();
    }
  });

  it("shows a roster failure instead of claiming there are no teachers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SekolahPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(screen.queryByText("Tiada guru dalam skop penyeliaan.")).toBeNull();
  });
});
