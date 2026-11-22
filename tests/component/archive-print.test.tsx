// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPayload } from "@/lib/schemas/rph";
import type { RphDocument } from "@/lib/types";

const download = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));
vi.mock("@/lib/client/archive-export", () => ({ downloadArchiveZip: download }));
const plans = [
  { id: "a", subjectName: "Matematik", status: "draft", planDate: "2026-10-05" },
  { id: "b", subjectName: "Bahasa", status: "submitted", planDate: "2026-10-06" },
].map((p) => ({
  ...p,
  schoolCode: "SK",
  ownerId: "teacher",
  classIds: ["c"],
  classNames: ["5 Amanah"],
  subjectCode: "X",
  session: "2026/2027",
  weekNo: 2,
  slotTime: "07:30",
  slotTimeEnd: "08:30",
  payload: emptyPayload(),
  version: 1,
  clientUpdatedAt: 0,
})) as RphDocument[];

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-week", () => ({ useArchive: () => plans }));
vi.mock("@/lib/hooks/use-calendar", () => ({ useCurrentWeek: () => 3 }));
vi.mock("@/lib/hooks/use-session", () => ({ useSession: () => "2026/2027" }));
vi.mock("@/lib/hooks/use-school", () => ({ useSchool: () => ({ name: "Sekolah" }) }));
vi.mock("@/components/shell/user-context", () => ({ useUser: () => ({ fullName: "Guru" }) }));
vi.mock("@/lib/hooks/use-signature", () => ({
  useSignature: () => ({ signature: null, state: "none", loading: false }),
}));
vi.mock("@/components/rph/week-sheets", () => ({
  WeekSheets: ({ documents }: { documents: RphDocument[] }) => (
    <div>week:{documents.map((p) => p.id).join(",")}</div>
  ),
}));
vi.mock("@/components/rph/rph-paper", () => ({
  RphPaper: ({ subjectName }: { subjectName: string }) => <div>plan:{subjectName}</div>,
}));

const { default: ArkibPage } = await import("@/app/(app)/arkib/page");
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  download.mockClear();
});

describe("archive printing", () => {
  it("prints the entire week even when search only shows one result", async () => {
    let output = "";
    vi.spyOn(window, "print").mockImplementation(() => {
      output = document.querySelector('[data-print="page"]')?.textContent ?? "";
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ArkibPage />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Matematik" } });
    fireEvent.click(screen.getByRole("button", { name: /Cetak semua RPH minggu 2/ }));
    await waitFor(() => expect(output).toContain("week:a,b"));
  });

  it("prints only the selected RPH", async () => {
    let output = "";
    vi.spyOn(window, "print").mockImplementation(() => {
      output = document.querySelector('[data-print="page"]')?.textContent ?? "";
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ArkibPage />
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Tindakan lain untuk 5 Amanah Matematik/ }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Cetak 5 Amanah Matematik/ }));
    await waitFor(() => expect(output).toContain("plan:Matematik"));
    expect(output).not.toContain("Bahasa");
  });

  it("exports the whole session even when searching", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ArkibPage />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Matematik" } });
    fireEvent.click(screen.getByRole("button", { name: /Muat turun ZIP sesi 2026\/2027/ }));
    fireEvent.click(screen.getByRole("button", { name: "Muat turun ZIP PDF" }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0]?.[0]).toEqual(plans);
    expect(download.mock.calls[0]?.[4]).toBe("pdf");
  });

  it("offers week and individual ZIP downloads", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ArkibPage />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Muat turun ZIP minggu 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Muat turun ZIP DOCX" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]?.[0]).toEqual(plans);
    expect(download.mock.calls[0]?.[4]).toBe("docx");
    fireEvent.click(
      screen.getByRole("button", { name: /Tindakan lain untuk 5 Amanah Matematik/ }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("menuitem", {
            name: /Muat turun ZIP 5 Amanah Matematik/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Muat turun ZIP 5 Amanah Matematik/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Muat turun ZIP PDF" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(download.mock.calls[1]?.[0]).toEqual([plans[0]]);
  });
});
