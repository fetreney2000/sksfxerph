// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserProvider } from "@/components/shell/user-context";

/**
 * The template library, rendered.
 *
 * Both of a template's two doors now open the penyunting: **Cipta** with
 * nothing behind it, **Sunting** with the row it is changing. What this pins
 * is that each card still leads where it says it leads, that a template you
 * do not own offers no handle on it, and that Padam — which never moved —
 * still asks before it deletes.
 *
 * What the penyunting does once it is open is covered by the e2e suite.
 * This is the library.
 */

// The page gates on `supabaseConfigured`, which is false in this test
// environment — and without it the create button is disabled by design.
vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return { ...original, supabaseConfigured: true };
});

const pushed = vi.hoisted(() => ({ href: "" as string }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushed.href = href;
    },
  }),
}));

const OWN_ID = "11111111-1111-4111-8111-111111111111";

const SUBJECTS = [
  { code: "MAT", nama: "Matematik", curriculum: "KSSR" as const },
  { code: "SAIN", nama: "Sains", curriculum: "KSSR" as const },
];

const TEMPLATES = [
  {
    id: OWN_ID,
    owner_id: "00000000-0000-4000-8000-000000000001",
    title: "Matematik Tahun 5 · SK 3.1",
    subject_code: "MAT",
    tahap: "Tahun 5",
    curriculum: "KSSR" as const,
    visibility: "school" as const,
    use_count: 24,
    owner: { full_name: "Suhaila binti Hassan" },
    payload: {},
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    owner_id: "someone-else",
    title: "Sains Tahun 4 · Proses Mendengar",
    subject_code: "SAIN",
    tahap: "Tahun 4",
    curriculum: "KSSR" as const,
    visibility: "school" as const,
    use_count: 11,
    owner: { full_name: "Ramlan bin Yusof" },
    payload: {},
  },
];

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

  if (url.includes("/api/subjects")) return json({ items: SUBJECTS });
  if (url.includes("/api/templates")) return json({ items: TEMPLATES, session: "2026/2027" });
  return json({});
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  pushed.href = "";
  calls.length = 0;
});

async function mount() {
  const { default: TemplatPage } = await import("@/app/(app)/templat/page");
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <UserProvider
        user={{
          id: "00000000-0000-4000-8000-000000000001",
          fullName: "Suhaila",
          role: "guru_biasa",
        }}
      >
        <TemplatPage />
      </UserProvider>
    </QueryClientProvider>,
  );
}

describe("perpustakaan templat", () => {
  it("routes Cipta to the penyunting rather than opening a dialog", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();
    await waitFor(() => expect(screen.getByText("Matematik Tahun 5 · SK 3.1")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Cipta templat/ }));

    expect(pushed.href).toBe("/templat/baru");
    // …and no dialog: a template's content cannot be typed into a form.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("routes Sunting to the penyunting with the template it is changing", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();
    await waitFor(() => expect(screen.getByText("Matematik Tahun 5 · SK 3.1")).toBeTruthy());

    // One handle per card, and only on the card this teacher owns: a template
    // somebody else shared with the school may be used, not touched.
    expect(screen.getAllByRole("button", { name: /Sunting/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Sunting Matematik Tahun 5/ }));

    expect(pushed.href).toBe(`/templat/baru?edit=${OWN_ID}`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still asks before it deletes", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    await mount();
    await waitFor(() => expect(screen.getByText("Matematik Tahun 5 · SK 3.1")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Padam Matematik Tahun 5/ }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByText(/tidak boleh dipulihkan/)).toBeTruthy();
    // Nothing is sent until Padam itself is pressed.
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
