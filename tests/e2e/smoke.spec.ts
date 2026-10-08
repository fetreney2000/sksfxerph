import { expect, type Page, test } from "@playwright/test";

/**
 * E2E smoke tests — the critical paths unit tests can't reach.
 *
 * IndexedDB seeding, hydration, the offline queue, client routing and now the
 * session gate only exist in a real browser, so this is what proves the app
 * actually works rather than merely compiles.
 *
 * Local mode credentials are the documented demo pair (see
 * lib/server/auth/local.ts); the login route takes the same scrypt path as a
 * real `erph.user` row would.
 */
const DEMO_USER = "cikgu";
const DEMO_PASS = "cikgu123";
/** Local-mode account with no supervisory permission (lib/server/auth/local.ts). */
const GURU_BIASA_USER = "guru.biasa";
const GURU_BIASA_PASS = "biasa123";
/** Local-mode Administrator — the only role that may open /pentadbiran. */
const PENTADBIR_USER = "pentadbir";
const PENTADBIR_PASS = "pentadbir123";

/** Collect anything React/Next would surface to a real user as a broken page. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (text.includes("favicon")) return;
    // A deliberate rejection (wrong password → 401, non-reviewer → 403) is the
    // browser narrating an expected HTTP status, not an application fault.
    // Server faults (5xx) still fail the test.
    if (/status of 4\d\d\b/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function login(page: Page, username = DEMO_USER, password = DEMO_PASS): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/Nama pengguna/).fill(username);
  await page.getByLabel(/Kata laluan/).fill(password);
  await page.getByRole("button", { name: "Log masuk" }).click();
  await page.waitForURL(/\/minggu/, { timeout: 15_000 });
}

test.describe("authentication", () => {
  test("redirects an unauthenticated visit to the login screen", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/minggu");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Log masuk" })).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("rejects a wrong password without revealing which field was wrong", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");
    await page.getByLabel(/Nama pengguna/).fill(DEMO_USER);
    await page.getByLabel(/Kata laluan/).fill("salah-sangat");
    await page.getByRole("button", { name: "Log masuk" }).click();

    // Generic message for unknown-user, wrong-password and inactive alike.
    await expect(page.getByText("Nama pengguna atau kata laluan salah.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/login/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a Guru Biasa is kept out of every supervisory screen", async ({ page }) => {
    const errors = collectErrors(page);
    await login(page, GURU_BIASA_USER, GURU_BIASA_PASS);

    // 1. The navigation must not offer what the role cannot reach — this is
    //    the "clear UI separation" requirement, checked on all three surfaces.
    await expect(page.getByRole("link", { name: /Semakan RPH/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Paparan Sekolah/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Laporan & Eksport/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Minggu Ini/ })).toHaveCount(1);

    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/Cari arahan/).fill("sekolah");
    await expect(page.getByText("Paparan Sekolah", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 2. Typing the URL must redirect, not render a screen full of data the
    //    role is not entitled to. The route group keeps the address the same.
    for (const url of ["/semakan", "/sekolah", "/laporan"]) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/minggu/, { timeout: 15_000 });
    }

    // 3. Their own surfaces still work.
    await expect(page.getByRole("heading", { name: /Selamat pagi/ })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("/pentadbiran is the Administrator's alone", async ({ page }) => {
    // A Guru Besar supervises but does not run the app — answer to "does the
    // Guru Besar get the setup page" was none.
    const errors = collectErrors(page);
    await login(page);
    await expect(page.getByRole("link", { name: /Urus eRPH/ })).toHaveCount(0);
    await page.goto("/pentadbiran");
    await expect(page).toHaveURL(/\/minggu/, { timeout: 15_000 });

    // Sign out properly: /login redirects an authenticated user to /minggu.
    await page.getByRole("button", { name: "Log keluar" }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    // The Administrator reaches it, and in local mode is told why it is empty.
    await login(page, PENTADBIR_USER, PENTADBIR_PASS);
    await expect(page.getByRole("link", { name: /Urus eRPH/ })).toHaveCount(1);
    await page.goto("/pentadbiran");
    await expect(page).toHaveURL(/\/pentadbiran/, { timeout: 15_000 });
    await expect(page.getByText(/Pentadbiran memerlukan mod disegerakkan/)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("signs in with the demo credentials", async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);

    // Identity comes from the cookie, resolved server-side in the layout.
    await expect(page.getByRole("heading", { name: /Selamat pagi/ })).toBeVisible();
    await expect(page.getByText("Nurul Aisyah")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("logs out and the session stops working immediately", async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);

    await page.getByRole("button", { name: "Log keluar" }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    // The cookie is gone: a direct hit on a protected route bounces again.
    await page.goto("/semakan");
    await expect(page).toHaveURL(/\/login/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the session cookie is httpOnly (not readable from JS)", async ({ page }) => {
    await login(page);
    const value = await page.evaluate(() => document.cookie);
    expect(value).not.toContain("erph_session");
  });
});

test.describe("eRPH smoke", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("dashboard seeds from IndexedDB and renders the week", async ({ page }) => {
    const errors = collectErrors(page);

    await expect(page.getByRole("heading", { name: /Selamat pagi/ })).toBeVisible();
    await expect(page.getByText("5 Amanah").first()).toBeVisible({ timeout: 15_000 });

    // The deadline must be a real Friday 16:00, not the off-by-a-month bug.
    await expect(page.getByText(/Jumaat, \d+ Oktober 2026 · 16:00/)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("command palette opens with Ctrl+K and filters", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/minggu");

    const dialog = page.getByRole("dialog", { name: "Arahan pantas" });

    // Ctrl+K is handled by a React listener, so it can only work once the
    // bundle has hydrated. Retry rather than racing the mount.
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(dialog).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 20_000 });

    // exact: the footer also says "↑↓ navigasi"
    await expect(dialog.getByText("Navigasi", { exact: true })).toBeVisible();

    await dialog.getByPlaceholder(/Cari arahan/).fill("semakan");
    await expect(dialog.getByText("Semakan RPH", { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("dark mode toggle persists across navigation", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/minggu");

    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Mod gelap" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.goto("/sekolah");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("editor opens an existing draft and shows completeness", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/minggu");

    const sambung = page.getByRole("button", { name: "Sambung" }).first();
    await expect(sambung).toBeVisible({ timeout: 15_000 });
    await sambung.click();

    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+/, { timeout: 15_000 });
    await expect(page.getByText(/Keluargaan dokumen/)).toBeVisible();
    await expect(page.getByText("Pratonton langsung")).toBeVisible();

    await page
      .getByRole("button", { name: /Refleksi/ })
      .first()
      .click();
    await expect(page.getByText(/Langkah 4/).first()).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("review queue grades with the keyboard (Lampiran 7)", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/semakan");

    await expect(page.getByText("Baris gilir")).toBeVisible();
    const before = await page.getByText(/Belum semak \((\d+)\)/).textContent();

    // `1` = Lengkap, exactly as the KPM Garis Panduan specifies.
    await page.keyboard.press("1");

    await expect(page.getByText(/Gred 1 · Lengkap/)).toBeVisible({ timeout: 10_000 });
    const after = await page.getByText(/Belum semak \((\d+)\)/).textContent();
    expect(after).not.toBe(before);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("sync chip reports local mode, not a stuck queue", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/minggu");

    // Local mode must never show a phantom "n belum diselesaikan" — Dexie already holds
    // the data, so there is nothing pending.
    await expect(page.getByRole("status")).toHaveText(/Disegerakkan/, {
      timeout: 15_000,
    });
    await expect(page.getByRole("status")).not.toHaveText(/belum diselesaikan/);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("offline edit survives a reload (Dexie, not component state)", async ({
    page,
    context,
  }) => {
    const errors = collectErrors(page);

    // 1. Open a seeded draft and reach step 4 (Refleksi).
    await page.goto("/minggu");
    await page.getByRole("button", { name: "Sambung" }).first().click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+/, { timeout: 15_000 });
    await page
      .getByRole("button", { name: /Refleksi/ })
      .first()
      .click();

    const box = page.getByPlaceholder(/Apa yang berlaku/);
    await expect(box).toBeVisible();

    // 2. Cut the network — the whole point of the local-first design.
    await context.setOffline(true);
    await expect(page.getByText(/Luar talian|belum diselesaikan/).first()).toBeVisible({
      timeout: 15_000,
    });

    // 3. Edit while offline. This must not throw, warn, or lose the keystrokes.
    const marker = `Intervensi luar talian ${Date.now()}`;
    await box.fill(marker);
    await expect(box).toHaveValue(marker);

    // 4. Reload (network restored) — the value must come back from IndexedDB.
    await context.setOffline(false);
    await page.reload();
    await page
      .getByRole("button", { name: /Refleksi/ })
      .first()
      .click();
    await expect(page.getByPlaceholder(/Apa yang berlaku/)).toHaveValue(marker, {
      timeout: 15_000,
    });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the template page's create button opens a brand-new blank eRPH", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/templat");
    await page.getByRole("button", { name: /Cipta templat baharu/ }).click();

    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+/, { timeout: 15_000 });
    const first = page.url();

    // "Blank" means blank: none of the four sections has anything in it yet.
    await expect(page.getByText(/0 daripada 4 bahagian/)).toBeVisible({ timeout: 15_000 });

    // A second tap must not litter the dashboard with another empty plan —
    // an untouched blank is reused, because the natural key is unique per
    // lesson and cannot hold two plans for the same class/date anyway.
    await page.goto("/templat");
    await page.getByRole("button", { name: /Cipta templat baharu/ }).click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+/, { timeout: 15_000 });
    expect(page.url()).toBe(first);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("RPH baharu creates a blank plan instead of resuming an old one", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/minggu");
    await page
      .getByRole("button", { name: /RPH baharu/ })
      .first()
      .click();

    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+/, { timeout: 15_000 });
    await expect(page.getByText(/0 daripada 4 bahagian/)).toBeVisible({ timeout: 15_000 });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("service worker registers in production build", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/minggu");

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            if (!("serviceWorker" in navigator)) return "unsupported";
            const reg = await navigator.serviceWorker.getRegistration();
            return reg ? "registered" : "pending";
          }),
        { timeout: 15_000 },
      )
      .toBe("registered");

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
