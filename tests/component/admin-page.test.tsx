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
 * built against has no usable service key in CI. So the five tabs — which are
 * the entire deliverable — would otherwise ship with no test ever having drawn
 * them. These assert the things a regression would silently break: that each
 * tab exists, that the rows actually arrive, that the session and the school
 * code are *editable* (both were read-only for the whole life of this page),
 * and that the consequence of changing them is stated before the write rather
 * than after.
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
  jawatan: "guru_biasa",
  is_active: true,
  last_login_at: "2026-10-05T08:12:00Z",
  locked_until: null,
  failed_logins: 0,
  password_changed_at: "2026-03-01T00:00:00Z",
  supervisor_id: null,
  supervisor_name: null,
};

const MEMBERS: Member[] = [
  // Deliberately not in alphabetical order. An assertion of A→Z against a
  // fixture that is already A→Z tests nothing — the sort has to have
  // something to move.
  {
    user_id: "00000000-0000-4000-8000-000000000004",
    username: "zulkifli.rahman",
    full_name: "Zulkifli bin Rahman",
    email: null,
    // The Guru Besar. Their own card has nobody above them — the school has
    // one — so it must say that rather than offer an empty menu.
    role: "guru_besar",
    jawatan: "guru_besar",
    is_active: true,
    last_login_at: null,
    locked_until: null,
    failed_logins: 0,
    password_changed_at: null,
    supervisor_id: null,
    supervisor_name: null,
  },
  ME,
  {
    user_id: "00000000-0000-4000-8000-000000000002",
    username: "ramlan.yusof",
    full_name: "Ramlan bin Yusof",
    email: null,
    role: "gpk",
    // One of the three Penolong Kanan offices — a GPK's role cannot say which.
    jawatan: "pk_hem",
    is_active: true,
    last_login_at: null,
    // In the future → rendered as a locked account, not merely "inactive".
    locked_until: "2099-01-01T00:00:00Z",
    failed_logins: 5,
    password_changed_at: null,
    supervisor_id: null,
    supervisor_name: null,
  },
  {
    user_id: "00000000-0000-4000-8000-000000000003",
    username: "siti.rahmah",
    full_name: "Siti Rahmah binti Ali",
    email: null,
    role: "guru_biasa",
    // Nobody has set an office yet — a real state, not a missing field.
    jawatan: null,
    is_active: true,
    last_login_at: null,
    locked_until: null,
    failed_logins: 0,
    password_changed_at: null,
    // Supervised, so the select has a value rather than being blank.
    supervisor_id: "00000000-0000-4000-8000-000000000002",
    supervisor_name: "Ramlan bin Yusof",
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
    rph_per_week: 5,
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

const SCHOOL_INFO = {
  id: "33333333-3333-4333-8333-333333333333",
  kod_sekolah: "SK0000",
  nama: "SK St. Francis Xavier",
  level: "rendah",
  ppd: "PPD Keningau",
  jpn: "JPN Sabah",
  motto: "Bersatu Kita Teguh",
  logo_url: null,
};

/** The last PATCH to /api/admin/school, so a test can inspect what was sent. */
let lastPatch: FormData | null = null;

/** Every request the page made, so a test can prove a write went out. */
const calls: { url: string; method: string }[] = [];

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = (init?.method ?? "GET").toUpperCase();
  calls.push({ url, method });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  if (url.includes("/api/admin/school") && method === "PATCH") {
    lastPatch = (init?.body as FormData) ?? null;
    return json({ school: { ...SCHOOL_INFO, kod_sekolah: lastPatch?.get("kod_sekolah") } });
  }
  if (url.includes("/api/admin/school")) return json({ school: SCHOOL_INFO });
  if (url.includes("/api/admin/accounts")) return json({ items: MEMBERS });
  if (url.includes("/api/admin/classes")) return json(CLASSES);
  if (url.includes("/api/admin/subjects")) return json(SUBJECTS);
  if (url.includes("/api/admin/settings")) return json(SETTINGS);
  return json({});
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  lastPatch = null;
  calls.length = 0;
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
  // Mounts the whole console against six fixtures. Its timeout is not only its
  // own problem: an aborted mount leaves the previous render in the document,
  // and the next test then fails with a confusing "multiple elements" instead
  // of the timeout that actually happened.
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
  }, 20_000);

  it("lists accounts with their role, status and lock state", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    await waitFor(() => expect(screen.getByText("Nurul Aisyah binti Rahim")).toBeTruthy());

    // A future `locked_until` must read as a lock with its own remedy, not
    // collapse into "inactive" — the two need different buttons.
    expect(screen.getByText("Dikunci")).toBeTruthy();
    expect(screen.getByText("5 percubaan gagal")).toBeTruthy();
    expect(screen.getByText("Buka kunci")).toBeTruthy();

    // One control per account, and every row offers a password reset.
    expect(screen.getAllByLabelText(/^Peranan /).length).toBe(4);
    expect(screen.getAllByText("Tetap semula kata laluan")).toHaveLength(4);
    // Three of the four are active; the fourth is locked, not merely inactive.
    expect(screen.getAllByText("Aktif")).toHaveLength(3);
    expect(screen.getByText("Dikunci")).toBeTruthy();
  });

  it("offers the supervision assignment to everyone with someone above them", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    await waitFor(() => expect(screen.getByText("Nurul Aisyah binti Rahim")).toBeTruthy());

    // Three of the four rows get a picker — the two teachers and the GPK.
    // The Guru Besar's own row has nobody above it in a school with one, and
    // says so instead of offering an empty menu.
    expect(screen.getAllByLabelText(/^Penyelia /)).toHaveLength(3);
    expect(screen.getByText("Tiada Guru Besar lain")).toBeTruthy();
    expect(screen.queryByLabelText("Penyelia Zulkifli bin Rahman")).toBeNull();

    // A GPK's own RPH is reviewed by the Guru Besar, so that is the whole of
    // their list — a peer GPK may not review it.
    const gpk = screen.getByLabelText("Penyelia Ramlan bin Yusof") as HTMLSelectElement;
    expect(Array.from(gpk.options).map((o) => o.textContent)).toEqual([
      "— belum ditetapkan —",
      "Zulkifli bin Rahman · Guru Besar",
    ]);

    // Unassigned is a real state, not a missing value, so it reads as blank.
    // (`toHaveValue` is jest-dom's; this project registers no setup file, so
    // the matcher simply is not there — plain assertions instead.)
    expect(
      (screen.getByLabelText("Penyelia Nurul Aisyah binti Rahim") as HTMLSelectElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Penyelia Siti Rahmah binti Ali") as HTMLSelectElement).value,
    ).toBe("00000000-0000-4000-8000-000000000002");

    // Only the level above may supervise, so a Guru Besar is offered
    // everywhere — teachers and the GPK — while a Guru Biasa is never
    // offered to anyone.
    const offered = screen.getAllByRole("option", {
      name: /Ramlan bin Yusof · Guru Penolong Kanan/,
    });
    expect(offered.length).toBe(2);
    const pgb = screen.getAllByRole("option", {
      name: /Zulkifli bin Rahman · Guru Besar/,
    });
    expect(pgb.length).toBe(3);
    expect(screen.queryByRole("option", { name: /Siti Rahmah .*Guru Biasa/ })).toBeNull();
  });

  it("offers the office the cover sheet prints, and only what the role may hold", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    await waitFor(() => expect(screen.getByText("Nurul Aisyah binti Rahim")).toBeTruthy());

    // One picker per row — and none for a role with no office to hold, which
    // this roster happens not to contain (the pentadbir's row is a dash).
    expect(screen.getAllByLabelText(/^Jawatan /)).toHaveLength(4);

    // A GPK's menu is the three Penolong Kanan offices, not the single one a
    // Guru Biasa gets: the role cannot say which office this person holds.
    const gpkSelect = screen.getByLabelText("Jawatan Ramlan bin Yusof") as HTMLSelectElement;
    expect(gpkSelect.value).toBe("pk_hem");
    expect(Array.from(gpkSelect.options).map((o) => o.textContent)).toEqual([
      "— belum ditetapkan —",
      "Penolong Kanan Pentadbiran",
      "Penolong Kanan HEM",
      "Penolong Kanan Kokum",
    ]);

    // Nobody has set Siti's office, and that reads as unset rather than being
    // filled in from the role beside it.
    expect(
      (screen.getByLabelText("Jawatan Siti Rahmah binti Ali") as HTMLSelectElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Jawatan Nurul Aisyah binti Rahim") as HTMLSelectElement).value,
    ).toBe("guru_biasa");
  });

  it("lays the roster out as cards, and searches it", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    const view = await mount();

    await waitFor(() => expect(screen.getByText("Nurul Aisyah binti Rahim")).toBeTruthy());

    // Cards rather than table rows: a seven-column table is a strip that
    // scrolls sideways on a phone, and this roster is seventy people long.
    expect(screen.queryByRole("table")).toBeNull();

    // A→Z by the name on the card. The endpoint orders by role, and the
    // fixture is deliberately shuffled, so this can only be the sort.
    const html = view.container.innerHTML;
    expect(html.indexOf("Nurul Aisyah binti Rahim")).toBeLessThan(
      html.indexOf("Zulkifli bin Rahman"),
    );
    expect(html.indexOf("Ramlan bin Yusof")).toBeLessThan(
      html.indexOf("Siti Rahmah binti Ali"),
    );

    // Every field the table had is still on the card, under its own label.
    expect(screen.getAllByLabelText(/^Peranan /)).toHaveLength(4);
    expect(screen.getAllByLabelText(/^Jawatan /)).toHaveLength(4);

    const search = screen.getByLabelText("Cari akaun") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "ramlan" } });
    await waitFor(() => expect(screen.getByText("Ramlan bin Yusof")).toBeTruthy());
    expect(screen.queryByText("Nurul Aisyah binti Rahim")).toBeNull();

    // A search that matches nothing says so, rather than showing an empty grid
    // that reads as "this school has no accounts".
    fireEvent.change(search, { target: { value: "tiada seorang pun begini" } });
    await waitFor(() => expect(screen.getByText(/Tiada akaun sepadan dengan/)).toBeTruthy());
  });

  it("edits and archives from the cards, not just renders the buttons", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    await waitFor(() => expect(screen.getByText("Ramlan bin Yusof")).toBeTruthy());

    // 1. The reset-password dialog still opens from a card's footer — this is
    //    the control that exists only on an account row.
    fireEvent.click(screen.getAllByRole("button", { name: /Tetap semula kata laluan/ })[0]!);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // 2. A role change on a card sends the write. The handler is the one the
    //    table row had; what changed is what it is rendered inside.
    fireEvent.change(screen.getByLabelText("Peranan Ramlan bin Yusof"), {
      target: { value: "guru_besar" },
    });
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "PATCH" && c.url.includes("/api/admin/accounts")),
      ).toBe(true),
    );

    // 3. Classes: the edit dialog opens…
    clickTab("Kelas");
    await waitFor(() => expect(screen.getByText("5 Amanah")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /Sunting/ })[0]!);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // 4. …and archiving writes.
    fireEvent.click(screen.getByRole("button", { name: /Arkibkan/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH" && c.url.includes("/api/classes"))).toBe(
        true,
      ),
    );
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

  it("makes the school code editable — and actually sends it", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    clickTab("Maklumat sekolah");

    // It used to be a Badge: readable, immutable, and the one field on this
    // form that had to be changed in `.env` and redeployed to take effect.
    const code = (await screen.findByLabelText(/Kod sekolah/)) as HTMLInputElement;
    expect(code.readOnly).toBe(false);
    expect(code.value).toBe("SK0000");

    fireEvent.change(code, { target: { value: "BBA4039" } });
    fireEvent.click(screen.getByRole("button", { name: /Simpan maklumat sekolah/ }));

    // The value has to reach the API, not merely look editable.
    await waitFor(() => expect(lastPatch).toBeTruthy());
    expect(lastPatch?.get("kod_sekolah")).toBe("BBA4039");
    // …alongside everything else the form owns, since it is one multipart save.
    expect(lastPatch?.get("nama")).toBe("SK St. Francis Xavier");
  });

  it("refuses a malformed school code before anything is sent", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();

    clickTab("Maklumat sekolah");

    const code = (await screen.findByLabelText(/Kod sekolah/)) as HTMLInputElement;
    fireEvent.change(code, { target: { value: "bad code!" } });
    fireEvent.click(screen.getByRole("button", { name: /Simpan maklumat sekolah/ }));

    // Same sentence the SQL function would raise — and no round trip to learn it.
    await screen.findByText(/3-24 aksara/);
    expect(lastPatch).toBeNull();
  });
});
