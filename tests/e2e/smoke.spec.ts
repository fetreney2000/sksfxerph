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

/**
 * Any of the four, because the greeting is chosen from the school's clock
 * (`greetingPart` in lib/date.ts). Asserting "pagi" would make the suite fail
 * every night it happens to run after seven, for no defect at all.
 */
const GREETING = /Selamat (pagi|tengah hari|petang|malam)/;

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
  // Either home, per `homeFor`: every teaching role lands on /minggu, the
  // Administrator — who holds no `rph` — on /utama.
  await page.waitForURL(/\/(minggu|utama)/, { timeout: 15_000 });
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
    await expect(page.getByRole("link", { name: /Laporan dan Eksport/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Minggu Ini/ })).toHaveCount(1);
    // A Guru Biasa holds no review stage, so the queue band is not for them.
    await expect(page.getByRole("link", { name: /RPH menunggu semakan/ })).toHaveCount(0);

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

    // 3. Their own surfaces still work — and it is *only* their own. The
    //    school's totals used to sit on this dashboard under the same heading
    //    as the teacher's own week; they are a supervisor's question now, and
    //    a role that cannot act on them no longer sees them.
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible();
    await expect(page.getByText(/Sekolah · Minggu \d+/)).toHaveCount(0);
    await expect(page.getByText("pematuhan sekolah")).toHaveCount(0);

    // What they do see is their own week, card by card. The approved card
    // names its week; the other two are exact.
    await expect(page.getByText(/^Disahkan · Minggu \d+$/)).toBeVisible();
    await expect(page.getByText("Menunggu semakan", { exact: true })).toBeVisible();
    await expect(page.getByText("Perlu tindakan", { exact: true })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the consolidated admin home is the Administrator's alone", async ({ page }) => {
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
    // They land on their one dashboard, not a teacher's and not a second home.
    await expect(page).toHaveURL(/\/utama/, { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Papan Pemuka" })).toHaveCount(1);

    // A teacher's screens must refuse them — they hold no plans to show.
    await page.goto("/minggu");
    await expect(page).toHaveURL(/\/utama/, { timeout: 15_000 });
    await page.goto("/editor");
    await expect(page).toHaveURL(/\/utama/, { timeout: 15_000 });
    await page.goto("/arkib");
    await expect(page).toHaveURL(/\/utama/, { timeout: 15_000 });

    // The old route is a redirect into the one home, not a second console.
    await page.goto("/pentadbiran");
    await expect(page).toHaveURL(/\/utama/, { timeout: 15_000 });
    await expect(page.getByText(/Papan Pemuka memerlukan mod disegerakkan/)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("signs in with the demo credentials", async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);

    // Identity comes from the cookie, resolved server-side in the layout.
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible();
    // cikgu is a Guru Besar. The review queue is the first thing above her own
    // teaching week — the home answers "what needs my decision?" without
    // taking the week away.
    await expect(page.getByRole("link", { name: /RPH menunggu semakan/ })).toBeVisible();
    // Scoped to the sidebar on purpose. The teacher's name also prints on the
    // weekly sheets waiting in the hidden print container — one row per plan
    // — so an unscoped query is ambiguous by design, not by accident.
    await expect(
      page.getByRole("complementary", { name: "Navigasi utama" }).getByText("Nurul Aisyah"),
    ).toBeVisible();
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

  test("one account on a shared browser never sees another's plans", async ({ page }) => {
    const errors = collectErrors(page);

    // 1. A teacher signs in on the staff-room laptop and has a week of plans.
    //    They live in IndexedDB, which the next account on this machine shares.
    await login(page);
    // Scope to the visible table: the phone cards carry the same class text in
    // the DOM but are `display:none` at this viewport, and an unscoped
    // `.first()` now resolves to the hidden copy.
    await expect(
      page
        .getByRole("table")
        .getByText(/5 Amanah/)
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // 2. Sign out. Nothing is deleted: the point of an offline cache is that
    //    the plans are still here when this teacher comes back.
    await page.getByRole("button", { name: "Log keluar" }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    // 3. A colleague signs in on the same browser. Their dashboard must be
    //    their own — previously every plan in the store was filed under one
    //    shared owner, so the previous teacher's week rendered as theirs.
    await login(page, GURU_BIASA_USER, GURU_BIASA_PASS);
    await expect(page.getByText(/5 Amanah/)).toHaveCount(0);
    await expect(
      page
        .getByRole("table")
        .getByText(/Belum ada RPH untuk/)
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // 4. And the first teacher gets theirs back — the cache was scoped, not
    //    emptied.
    await page.getByRole("button", { name: "Log keluar" }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await login(page);
    await expect(
      page
        .getByRole("table")
        .getByText(/5 Amanah/)
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("eRPH smoke", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("dashboard seeds from IndexedDB and renders the week", async ({ page }) => {
    const errors = collectErrors(page);

    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible();
    await expect(page.getByRole("table").getByText("5 Amanah").first()).toBeVisible({
      timeout: 15_000,
    });

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
    await expect(page.getByText(/Kelengkapan dokumen/)).toBeVisible();
    await expect(page.getByText("Pratonton langsung")).toBeVisible();
    // The topbar resolves the nested editor route instead of falling back to
    // "eRPH", and the crumb names the page rather than only the week.
    await expect(
      page.locator("header").getByRole("heading", { name: "Penyunting RPH" }),
    ).toBeVisible();
    await expect(page.locator("header").getByText("Draf aktif", { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: /Refleksi/ })
      .first()
      .click();
    await expect(page.getByText(/Bahagian 4/).first()).toBeVisible();

    // An incomplete plan cannot be submitted without acknowledging that it is
    // going to the GPK now, not saved as a draft.
    await page.getByRole("button", { name: "Hantar untuk semakan" }).click();
    const submit = page.getByRole("dialog", { name: "Hantar RPH untuk semakan?" });
    await expect(submit).toBeVisible();
    await expect(
      submit.getByRole("button", { name: "Hantar juga (tidak lengkap)" }),
    ).toBeVisible();
    await expect(submit.getByText(/akan dihantar kepada GPK sekarang/)).toBeVisible();
    await submit.getByRole("button", { name: "Batal" }).click();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("review queue decides with the keyboard — sahkan or kembalikan", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/semakan");

    await expect(page.getByRole("heading", { name: "Giliran semakan" })).toBeVisible();
    const before = await page.getByText(/Belum semak \((\d+)\)/).textContent();

    // `1` = sahkan. There is no longer a Guru Besar to forward to: a GPK
    // approves here, and the Guru Besar does exactly the same thing on any
    // teacher's plan. Local mode skips the signature — there is no database
    // to file it against; synced mode signs first and /api/rpc/review
    // verifies before it will append anything.
    await page.keyboard.press("1");

    await expect(page.getByText(/Disahkan dan ditandatangani/)).toBeVisible({
      timeout: 10_000,
    });
    const after = await page.getByText(/Belum semak \((\d+)\)/).textContent();
    expect(after).not.toBe(before);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("returning a plan needs a reason", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/semakan");

    await expect(page.getByRole("heading", { name: "Giliran semakan" })).toBeVisible();
    // These KPIs count this browser session; their labels must say so rather
    // than implying they are totals for the queue.
    await expect(page.getByText("Disahkan sesi ini")).toBeVisible();
    await expect(page.getByText("Dikembalikan sesi ini")).toBeVisible();

    const kembali = page.getByRole("button", { name: /^Kembalikan/ });
    await expect(kembali).toBeDisabled();
    await expect(
      page.getByText(/Tulis sebab atau pilih daripada senarai semak/).first(),
    ).toBeVisible();

    // A quick checklist chip is a reason too; filling the comment is the
    // general path and must re-enable the decision.
    await page.getByLabel(/Maklum balas sulit/).fill("Sila lengkapkan bahagian Refleksi.");
    await expect(kembali).toBeEnabled();

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

    // Label, not placeholder: the penyunting no longer fills its fields with
    // example text a teacher could mistake for their own.
    const box = page.getByLabel(/Refleksi/);
    await expect(box).toBeVisible();

    // 2. Cut the network — the whole point of the local-first design. The UI
    //    no longer says so anywhere; what proves it is that the next steps
    //    work with the network down.
    await context.setOffline(true);

    // 3. Edit while offline. This must not throw, warn, or lose the keystrokes.
    const marker = `Refleksi luar talian ${Date.now()}`;
    await box.fill(marker);
    await expect(box).toHaveValue(marker);

    // 4. Reload (network restored) — the value must come back from IndexedDB.
    await context.setOffline(false);
    await page.reload();
    await page
      .getByRole("button", { name: /Refleksi/ })
      .first()
      .click();
    await expect(page.getByLabel(/Refleksi/)).toHaveValue(marker, {
      timeout: 15_000,
    });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("creating a template opens the penyunting, not a dialog", async ({ page }) => {
    const errors = collectErrors(page);

    // The tile that used to sit here claimed "Cipta templat" and opened a
    // dialog that collected a title and three dropdowns — an empty template,
    // with nothing in it to start from.
    await page.goto("/templat");
    // Local mode has no database to write a template to, so the button says
    // so instead of letting someone write a whole plan before the 503.
    await expect(page.getByRole("button", { name: "Cipta templat" })).toBeDisabled();

    await page.goto("/templat/baru");
    await expect(page).toHaveURL(/\/templat\/baru/, { timeout: 15_000 });
    // The profil section's own subtitle — it says what a template keeps, and
    // the plan penyunting's says "Kelas · tarikh · masa · tema".
    await expect(page.getByText("Subjek · tema · bidang · tajuk")).toBeVisible({
      timeout: 15_000,
    });

    // A template stores no class, no week, no date and no lesson time, so the
    // penyunting does not offer them — a field whose answer goes nowhere.
    await expect(page.getByLabel("Kelas")).toHaveCount(0);
    await expect(page.getByLabel("Tarikh")).toHaveCount(0);
    await expect(page.locator('input[type="date"]')).toHaveCount(0);

    // …and what it offers instead of "Simpan rancangan".
    await expect(page.getByRole("button", { name: /Simpan sebagai templat/ })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the penyunting asks for a template's name before it writes anything", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto("/templat/baru");
    await expect(page.getByRole("button", { name: /Simpan sebagai templat/ })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /Simpan sebagai templat/ }).click();
    await expect(page.getByRole("heading", { name: "Simpan sebagai templat" })).toBeVisible();

    // A name is required, and it is refused before anything is sent.
    // Scoped to the dialog: the profil section has its own "Tajuk" field.
    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: "Cipta templat", exact: true }).click();
    await expect(dialog.getByText("Tajuk templat diperlukan.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Simpan sebagai templat" })).toBeVisible();

    // Cancelling loses nothing else either: the plan is still on the screen,
    // still unsaved, exactly as it was before the dialog opened.
    await dialog.getByLabel(/^Tajuk/).fill("Matematik Tahun 5 · SK 3.1");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(page.getByRole("heading", { name: "Simpan sebagai templat" })).toHaveCount(0);
    await expect(page.getByText("Subjek · tema · bidang · tajuk")).toBeVisible();
    await expect(page.getByText("Belum disimpan")).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the penyunting still files a real plan", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/templat/baru");
    await expect(page.getByText("Subjek · tema · bidang · tajuk")).toBeVisible({
      timeout: 15_000,
    });

    // Back out the same way the screen offers. Scoped to <main>: the sidebar
    // and the mobile bar carry the same destination.
    await page.getByRole("main").getByRole("link", { name: "Perpustakaan Templat" }).click();
    await expect(page).toHaveURL(/\/templat/);

    await page.goto("/editor");
    // The plan penyunting is unchanged by sharing a component with the
    // template route: the fields a template drops are still here.
    await expect(page.getByRole("button", { name: /Simpan rancangan/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel("Kelas")).toBeVisible();
    await expect(page.getByLabel("Tarikh")).toBeVisible();
    await expect(page.getByLabel("Masa Mula")).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the penyunting opens blank and creates nothing until saved", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/minggu");
    await page
      .getByRole("button", { name: /RPH baharu/ })
      .first()
      .click();

    // No id in the URL: nothing has been written. It used to redirect to
    // /editor/<uuid>, so merely *opening* the penyunting left a draft behind.
    await expect(page).toHaveURL(/\/editor$/, { timeout: 15_000 });
    await expect(page.getByText(/0 daripada 4 bahagian/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Belum disimpan")).toBeVisible();
    // With nothing to submit yet, the action bar offers the save instead.
    await expect(page.getByRole("button", { name: /Simpan rancangan/ })).toBeVisible();

    // Walking away must still have created nothing — no draft on the dashboard.
    await page.goto("/minggu");
    await expect(page).toHaveURL(/\/minggu/);
    await page
      .getByRole("button", { name: /RPH baharu/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/editor$/, { timeout: 15_000 });

    // Saving is what makes it real, and the URL follows so a refresh lands on it.
    await page.getByRole("button", { name: /Simpan rancangan/ }).click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{8}-/, { timeout: 15_000 });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a missed week can be filled in from the archive", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/arkib");

    // Every week that has happened is listed, not only the weeks with plans
    // in them — a week with nothing filed under it used not to appear here at
    // all, which hid exactly the week a teacher needed to see.
    const add = page.getByRole("button", { name: /Tambah RPH/ });
    await expect(add.first()).toBeVisible({ timeout: 15_000 });

    // Week 1 is as far back as it goes, and its Monday is 16 March 2026.
    await add.last().click();
    await expect(page).toHaveURL(/\/editor\?week=1$/, { timeout: 15_000 });
    await expect(page.getByLabel("Minggu", { exact: true })).toHaveValue("1");
    // The date comes with the week, so what the page prints and the week its
    // figures land in cannot disagree.
    await expect(page.getByLabel("Tarikh", { exact: true })).toHaveValue("2026-03-16");

    // Saving files it there. Still a draft, so the archive counts it as
    // unsent rather than claiming a week that was handed in.
    await page.getByRole("button", { name: /Simpan rancangan/ }).click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{8}-/, { timeout: 15_000 });

    await page.goto("/arkib");
    const week1 = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "Minggu 1", exact: true }) });
    await expect(week1.getByText("0 / 1")).toBeVisible({ timeout: 15_000 });
    await expect(week1.getByRole("button", { name: /Buka/ })).toBeVisible();

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

test.describe("mobile layout", () => {
  test("the bottom bar keeps four primary tabs and moves the rest into Lagi", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const nav = page.getByRole("navigation", { name: "Navigasi utama mudah alih" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Minggu" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Semak" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sekolah" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Laporan" })).toBeVisible();
    // Arkib and Templat are still reachable; they are just not a fifth and
    // sixth tab squeezed into 390px.
    await expect(nav.getByRole("link", { name: "Arkib" })).toHaveCount(0);

    await nav.getByRole("button", { name: "Lagi" }).click();
    const sheet = page.getByRole("dialog", { name: "Lagi" });
    await expect(sheet.getByRole("link", { name: /Sejarah dan Arkib/ })).toBeVisible();
    await expect(sheet.getByRole("link", { name: /Perpustakaan Templat/ })).toBeVisible();

    await sheet.getByRole("link", { name: /Sejarah dan Arkib/ }).click();
    await expect(page).toHaveURL(/\/arkib/, { timeout: 15_000 });
    await expect(page.getByRole("dialog", { name: "Lagi" })).toBeHidden();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the avatar opens the account menu and signs out on a phone", async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    await page.getByRole("button", { name: "Akaun Nurul Aisyah binti Rahim" }).click();
    const menu = page.getByRole("menu", { name: "Akaun" });
    await expect(menu.getByText("Nurul Aisyah binti Rahim")).toBeVisible();
    await expect(menu.getByText("Guru Besar")).toBeVisible();

    await menu.getByRole("menuitem", { name: "Log keluar" }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Semakan opens a plan full-screen with the decisions in reach", async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/semakan");

    await expect(page.getByRole("heading", { name: "Giliran semakan" })).toBeVisible();
    await page.getByRole("button", { name: /Ramlan/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize() ?? { width: 390, height: 844 };
    // The plan gets the whole viewport, not a centred 480px card. Compare
    // against the viewport rather than a hardcoded 390: a one-pixel rounding
    // difference from `100vw` is not a layout failure.
    expect(box?.width ?? 0).toBeGreaterThan(viewport.width * 0.98);
    expect(box?.height ?? 0).toBeGreaterThan(viewport.height * 0.98);

    // Scroll the long printed plan as far as the auto-check panel, then prove
    // both decisions are still on screen. This is the whole point of keeping
    // them outside the scrolling body.
    await dialog.getByText("Semakan automatik").scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Sahkan" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Kembalikan" })).toBeVisible();

    await dialog.getByRole("button", { name: "Sahkan" }).click();
    await expect(page.getByText(/Disahkan dan ditandatangani/)).toBeVisible({
      timeout: 10_000,
    });

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
