// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserProvider } from "@/components/shell/user-context";
import type { Member } from "@/lib/client/admin";

/**
 * The administrator console, rendered.
 *
 * `/pentadbiran` cannot be reached by e2e: local mode stops at "Pentadbiran
 * memerlukan mod disegerakkan" by design, and the synced deployment this is
 * built against has no usable service key in CI. So the four tabs — which are
 * the entire deliverable — would otherwise ship with no test ever having drawn
 * them. These assert the things a regression would silently break: that each
 * tab exists, that the rows actually arrive, that the session field is
 * *editable* (it was read-only for the whole life of this page), and that the
 * consequence of changing it is stated before the write rather than after.
 */

// The page gates on `supabaseConfigured`, which is false in this test
// environment. Keep every other export real so `SCHOOL`/`SESSION` still resolve.
vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

const ME: Member = {
  user_id: "00000000-0000-4000-8000-000000000001",
  username: "nurul.aisyah",
  full_name: "Nurul Aisyah binti Rahim",
  email: "nurul@sk0000.local",
  role: "guru_biasa",
  is_active: true,
  last_login_at: "2026-10-05T08:12:00Z",
  locked_until: null,
  failed_logins: 0,
  password_changed_at: "2026-03-01T00:00:00Z",
};

const MEMBERS: Member[] = [
  ME,
  {
    user_id: "00000000-0000-4000-8000-000000000002",
    username: "ramlan.yusof",
    full_name: "Ramlan bin Yusof",
    email: null,
    role: "gpk",
    is_active: true,
    last_login_at: null,
    // In the future → rendered as a locked account, not merely "inactive".
    locked_until: "2099-01-01T00:00:00Z",
    failed_logins: 5,
    password_changed_at: null,
  },
];

const CLASSES = {
  session: "2026/2027",
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      nama: "5 Amanah",
      tahun: 5,
      tingkatan: null,
      is_active: true,
      doc_count: 12,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      nama: "4 Melur",
      tahun: 4,
      tingkatan: null,
      is_active: false,
      doc_count: 3,
    },
  ],
};

const SUBJECTS = {
  items: [
    { code: "MAT", nama: "Matematik", curriculum: "KSSR", is_active: true, doc_count: 40 },
    { code: "BI", nama: "Bahasa Inggeris", curriculum: "KSSR", is_active: false, doc_count: 7 },
  ],
};

const SETTINGS = {
  setting: {
    current_session: "2026/2027",
    submit_weekday: 5,
    submit_time: "16:00:00",
    require_complete: true,
  },
  school: {
    id: "33333333-3333-4333-8333-333333333333",
    kod_sekolah: "SK0000",
    nama: "SK St. Francis Xavier",
    level: "rendah",
    ppd: "PPD Keningau",
    jpn: "JPN Sabah",
  },
};

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  if (url.includes("/api/admin/accounts")) return json({ items: MEMBERS });
  if (url.includes("/api/admin/classes")) return json(CLASSES);
  if (url.includes("/api/admin/subjects")) return json(SUBJECTS);
  if (url.includes("/api/admin/settings")) return json(SETTINGS);
  return json({});
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Mount the page with a fresh QueryClient — each test gets an empty cache. */
async function mount() {
  const { default: Page } = await import("@/app/(app)/(pentadbiran)/pentadbiran/page");
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <UserProvider
        user={{ id: ME.user_id, fullName: "Faridah binti Salleh", role: "pentadbir" }}
      >
        <Page />
      </UserProvider>
    </QueryClientProvider>,
  );
}

/**
 * Radix's TabsTrigger activates on `mousedown` (so a drag away does not commit),
 * which `fireEvent.click` alone never delivers — the tab would silently not
 * switch and every assertion after it would look for content on the wrong pane.
 */
function clickTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

describe("pentadbiran", () => {
  it("offers every part of the set-up console", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    for (const label of [
      "Akaun & peranan",
      "Kelas",
      "Mata pelajaran",
      "Maklumat sekolah",
      "Sesi & tarikh akhir",
    ]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
  });

  it("lists accounts with their role, status and lock state", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    await waitFor(() => expect(screen.getByText("Nurul Aisyah binti Rahim")).toBeTruthy());

    // A future `locked_until` must read as a lock with its own remedy, not
    // collapse into "inactive" — the two need different buttons.
    expect(screen.getByText("Dikunci")).toBeTruthy();
    expect(screen.getByText("5 percubaan gagal")).toBeTruthy();
    expect(screen.getByText("Buka kunci")).toBeTruthy();

    // One control per account, and both rows offer a password reset.
    expect(screen.getAllByLabelText(/^Peranan /).length).toBe(2);
    expect(screen.getAllByText("Tetap semula kata laluan")).toHaveLength(2);
    expect(screen.getByText("Aktif")).toBeTruthy();
  });

  it("lists classes with plan counts, archived ones included", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    clickTab("Kelas");

    await waitFor(() => expect(screen.getByText("5 Amanah")).toBeTruthy());
    expect(screen.getByText("12 rancangan")).toBeTruthy();
    // Archived rows belong here — this is the administrator's view, not the
    // editor's. The whole point of `doc_count` is that archiving shows what it
    // touches.
    expect(screen.getByText("Diarkibkan")).toBeTruthy();
    expect(screen.getByText("Arkibkan")).toBeTruthy();
    expect(screen.getByText("Pulihkan")).toBeTruthy();
    expect(screen.getAllByText("Sunting")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Tambah kelas/ })).toBeTruthy();
  });

  it("makes the session editable and states the consequence before writing", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    clickTab("Sesi & tarikh akhir");

    // Regex: `required` renders a `*` inside the <label>, so its text content
    // is "Sesi semasa*" and an exact string match finds nothing.
    const field = (await screen.findByLabelText(/Sesi semasa/)) as HTMLInputElement;
    // The whole point of the tab: it is an input, not a read-only value.
    expect(field.readOnly).toBe(false);
    expect(field.value).toBe("2026/2027");

    fireEvent.change(field, { target: { value: "2027/2028" } });

    // Stated before the save, so the administrator can weigh it rather than
    // discover that every teacher's dashboard just emptied.
    await waitFor(() => expect(screen.getByText(/menjejaskan semua guru/)).toBeTruthy());
    expect(screen.getByText(/Tiada data dipadam/)).toBeTruthy();
  });
});
