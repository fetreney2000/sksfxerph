// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPayload, type RphPayload } from "@/lib/schemas/rph";
import type { RphDocument } from "@/lib/types";

const state = vi.hoisted(() => ({ plans: [] as RphDocument[] }));

const submit = vi.hoisted(() =>
  vi.fn(async (id: string) => ({
    ok: true,
    status: "submitted",
    completeness: 100,
    version: 2,
    id,
  })),
);
const submitBatch = vi.hoisted(() =>
  vi.fn(async (ids: string[]) => ({
    ok: true,
    count: ids.length,
    items: ids.map((id) => ({ id, version: 2 })),
  })),
);
vi.mock("@/lib/rpc", async (original) => ({
  ...(await original<typeof import("@/lib/rpc")>()),
  submitRph: submit,
  submitRphBatch: submitBatch,
}));
vi.mock("@/lib/config", async (original) => ({
  ...(await original<typeof import("@/lib/config")>()),
  supabaseConfigured: true,
}));
vi.mock("@/components/rph/copy-week-dialog", () => ({ CopyWeekDialog: () => null }));
vi.mock("@/components/rph/week-sheets", () => ({ WeekSheets: () => null }));
vi.mock("@/components/rph/rph-paper", () => ({ RphPaper: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-calendar", () => ({ useCurrentWeek: () => 3 }));
vi.mock("@/lib/hooks/use-session", () => ({ useSession: () => "2026/2027" }));
vi.mock("@/lib/hooks/use-school", () => ({ useSchool: () => ({ name: "Sekolah" }) }));
vi.mock("@/components/shell/user-context", () => ({ useUser: () => ({ fullName: "Guru" }) }));
vi.mock("@/lib/hooks/use-signature", () => ({
  useSignature: () => ({ signature: null, state: "none", loading: false }),
}));
vi.mock("@/lib/hooks/use-week", () => ({ useArchive: () => state.plans }));

const complete = (): RphPayload => ({
  ...emptyPayload(),
  standard_kandungan: "SK",
  standard_pembelajaran: "SP",
  objektif: "O",
  kriteria_kejayaan: "K",
  aktiviti: [{ nama: "Aktiviti", sub: false }],
  refleksi: "R",
});

function plan(
  id: string,
  status: RphDocument["status"],
  payload: RphPayload,
  subjectName = "Matematik",
): RphDocument {
  return {
    id,
    schoolCode: "SK",
    ownerId: "teacher",
    classIds: ["c"],
    classNames: ["5 Amanah"],
    subjectCode: subjectName === "Matematik" ? "MAT" : "BM",
    subjectName,
    session: "2026/2027",
    weekNo: 2,
    planDate: id === "p-2" ? "2026-10-06" : "2026-10-05",
    slotTime: "07:30",
    slotTimeEnd: "08:30",
    status,
    payload,
    version: 1,
    clientUpdatedAt: 0,
    createdAt: 0,
  };
}

const { default: ArkibPage } = await import("@/app/(app)/arkib/page");

afterEach(() => {
  cleanup();
  submit.mockClear();
  submitBatch.mockClear();
});

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ArkibPage />
    </QueryClientProvider>,
  );
}

describe("submitting from the archive", () => {
  it("offers only the whole-week submit action for drafts", () => {
    state.plans = [plan("p-1", "draft", complete())];
    mount();

    expect(screen.queryByRole("button", { name: /Hantar 5 Amanah Matematik/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Hantar semua RPH minggu 2/ })).toBeTruthy();
  });

  it("lets a returned plan be resubmitted without the incomplete rest of the week", async () => {
    state.plans = [
      plan("p-1", "returned", complete()),
      plan("p-2", "draft", emptyPayload(), "Bahasa Melayu"),
    ];
    mount();

    fireEvent.click(screen.getByRole("button", { name: /Hantar semula 5 Amanah Matematik/ }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith("p-1"));
    await waitFor(() =>
      expect(screen.getByText(/Matematik · 2026-10-05 dihantar semula/)).toBeTruthy(),
    );
    expect(submitBatch).not.toHaveBeenCalled();
  });

  it("does not submit a week when any plan is incomplete", async () => {
    state.plans = [
      plan("p-1", "draft", complete()),
      plan("p-2", "returned", emptyPayload(), "Bahasa Melayu"),
    ];
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Hantar semua RPH minggu 2/ }));

    const dialog = screen.getByRole("dialog", { name: /Hantar RPH minggu 2/ });
    expect(dialog).toBeTruthy();
    expect(screen.getByText(/tidak boleh dihantar kerana 1 RPH belum lengkap/)).toBeTruthy();
    expect(screen.getByText(/Bahasa Melayu · 5 Amanah · 2026-10-06/)).toBeTruthy();
    expect(screen.getByText(/Belum diisi:.*Standard Kandungan/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Hantar 2 RPH" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(submitBatch).not.toHaveBeenCalled();
  });

  it("submits every plan when the whole week is complete", async () => {
    state.plans = [
      plan("p-1", "draft", complete()),
      plan("p-2", "returned", complete(), "Bahasa Melayu"),
    ];
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Hantar semua RPH minggu 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hantar 2 RPH" }));
    await waitFor(() => expect(submitBatch).toHaveBeenCalledTimes(1));
    expect(submitBatch).toHaveBeenCalledWith(["p-1", "p-2"]);
    await waitFor(() =>
      expect(screen.getByText(/2 RPH minggu 2 dihantar untuk semakan/)).toBeTruthy(),
    );
  });

  it("reports a failed batch as nothing submitted", async () => {
    submitBatch.mockRejectedValueOnce(
      new Error("RPH 2026-10-06 (BM) belum lengkap - lengkapkan setiap seksyen wajib"),
    );
    state.plans = [
      plan("p-1", "draft", complete()),
      plan("p-2", "returned", complete(), "Bahasa Melayu"),
    ];
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Hantar semua RPH minggu 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hantar 2 RPH" }));
    await waitFor(() => expect(submitBatch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText(/tidak dihantar - .*belum lengkap.*Tiada RPH dihantar/),
      ).toBeTruthy(),
    );
  });
});
