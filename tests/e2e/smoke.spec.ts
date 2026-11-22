import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { unzipSync } from "fflate";

/**
 * E2E smoke tests - the critical paths unit tests can't reach.
 *
 * IndexedDB seeding and hydration, client routing and now the session gate
 * only exist in a real browser, so this is what proves the app actually works
 * rather than merely compiles. The suite runs against the offline dev harness
 * (no backend): synced mode is covered by the route-level unit tests.
 *
 * Local mode credentials are the documented demo pair (see
 * lib/server/auth/local.ts); the login route takes the same scrypt path as a
 * real `erph.user` row would. Teachers sign in by email; the pentadbir has no
 * school email and signs in by username - the split `/api/auth/login` applies
 * on a real deployment.
 */
const DEMO_EMAIL = "gpk@sktamanharmoni.local";
const DEMO_PASS = "gpk123";
/** Local-mode Guru Besar - reviews but teaches no class, so holds no plans. */
const GURU_BESAR_EMAIL = "nurul@sktamanharmoni.local";
const GURU_BESAR_PASS = "cikgu123";
/** Local-mode account with no supervisory permission (lib/server/auth/local.ts). */
const GURU_BIASA_EMAIL = "suhaila@sktamanharmoni.local";
const GURU_BIASA_PASS = "biasa123";
/** Local-mode Administrator - the only role that may open /pentadbiran. */
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

async function login(page: Page, identifier = DEMO_EMAIL, password = DEMO_PASS): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Emel").fill(identifier);
  await page.getByLabel(/Kata laluan/).fill(password);
  await page.getByRole("button", { name: "Log masuk" }).click();
  // Either home, per `homeFor`: every teaching role lands on /minggu, the
  // Guru Besar - who holds no plans - on /semakan, and the Administrator -
  // who holds no `rph` - on /utama.
  await page.waitForURL(/\/(minggu|semakan|utama)/, { timeout: 15_000 });
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
    await page.getByLabel("Emel").fill(DEMO_EMAIL);
    await page.getByLabel(/Kata laluan/).fill("salah-sangat");
    await page.getByRole("button", { name: "Log masuk" }).click();

    // Generic message for unknown-account, wrong-password and inactive alike.
    await expect(page.getByText("Emel atau kata laluan salah.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/login/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a Guru Biasa is kept out of every supervisory screen", async ({ page }) => {
    const errors = collectErrors(page);
    await login(page, GURU_BIASA_EMAIL, GURU_BIASA_PASS);

    // 1. The navigation must not offer what the role cannot reach - this is
    //    the "clear UI separation" requirement, checked on all three surfaces.
    await expect(page.getByRole("link", { name: /Semakan RPH/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Paparan Sekolah/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Laporan dan Eksport/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Minggu Ini/ })).toHaveCount(1);
    // A Guru Biasa holds no review stage, so the queue band is not for them.
    await expect(page.getByRole("link", { name: /RPH menunggu semakan/ })).toHaveCount(0);

    // 2. Typing the URL must redirect, not render a screen full of data the
    //    role is not entitled to. The route group keeps the address the same.
    for (const url of ["/semakan", "/sekolah"]) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/minggu/, { timeout: 15_000 });
    }

    // 3. Their own surfaces still work - and it is *only* their own. The
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
    // …and not the punctuality card, which is a supervisor's question.
    await expect(page.getByText("Ketepatan masa", { exact: true })).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the consolidated admin home is the Administrator's alone", async ({ page }) => {
    // A Guru Besar supervises but does not run the app - answer to "does the
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

    // A teacher's screens must refuse them - they hold no plans to show.
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
    // The demo account is a GPK: their own teaching week plus the review queue
    // above it - the home answers "what needs my decision?" without taking
    // the week away.
    await expect(page.getByRole("link", { name: /RPH menunggu semakan/ })).toBeVisible();
    // Scoped to the sidebar on purpose. The teacher's name also prints on the
    // weekly sheets waiting in the hidden print container - one row per plan
    // - so an unscoped query is ambiguous by design, not by accident.
    await expect(
      page.getByRole("complementary", { name: "Navigasi utama" }).getByText("Rizal"),
    ).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a Guru Besar lands on the review queue with no week of their own", async ({ page }) => {
    const errors = collectErrors(page);
    await login(page, GURU_BESAR_EMAIL, GURU_BESAR_PASS);

    // No `rph`: the teaching week is not theirs to open, so the queue is home.
    await expect(page).toHaveURL(/\/semakan/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Giliran semakan" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Minggu Ini/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Arkib eRPH/ })).toHaveCount(0);

    // And the gate bites server-side too, not just in the navigation.
    await page.goto("/minggu");
    await expect(page).toHaveURL(/\/semakan/, { timeout: 15_000 });
    await page.goto("/arkib");
    await expect(page).toHaveURL(/\/semakan/, { timeout: 15_000 });

    // No `rph` means no RPT either - there is nothing of theirs to attach.
    await expect(page.getByRole("link", { name: /^RPT$/ })).toHaveCount(0);
    await page.goto("/rpt");
    await expect(page).toHaveURL(/\/semakan/, { timeout: 15_000 });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a teacher reaches their RPT links from the Guru group", async ({ page }) => {
    const errors = collectErrors(page);
    await login(page);

    await expect(page.getByRole("link", { name: /^RPT$/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("link", { name: /^RPT$/ }).first().click();
    await expect(page).toHaveURL(/\/rpt/, { timeout: 15_000 });
    // Local mode has no backend and no reviewers: the page says so instead of
    // offering a form whose saves would go nowhere.
    await expect(page.getByText(/memerlukan mod disegerakkan/)).toBeVisible();

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
    //    their own - previously every plan in the store was filed under one
    //    shared owner, so the previous teacher's week rendered as theirs.
    await login(page, GURU_BIASA_EMAIL, GURU_BIASA_PASS);
    await expect(page.getByText(/5 Amanah/)).toHaveCount(0);
    await expect(
      page
        .getByRole("table")
        .getByText(/Belum ada RPH untuk/)
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // 4. And the first teacher gets theirs back - the cache was scoped, not
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

  test("the reports page has been removed", async ({ page }) => {
    await expect(page.getByRole("link", { name: /Laporan dan Eksport/ })).toHaveCount(0);
    await page.goto("/laporan");
    await expect(page.getByRole("heading", { name: "Halaman tidak dijumpai" })).toBeVisible();
  });

  test("dashboard seeds from IndexedDB and renders the week", async ({ page }) => {
    const errors = collectErrors(page);

    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible();
    await expect(page.getByRole("table").getByText("5 Amanah").first()).toBeVisible({
      timeout: 15_000,
    });

    // The deadline must be a real Friday 16:00, not the off-by-a-month bug.
    await expect(page.getByText(/Jumaat, \d+ \w+ \d{4} · 16:00/)).toBeVisible();

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

    // Bahagian 2 is Objektif + Kriteria Kejayaan - the printed form's
    // grouping, and what `completeness()` scores. The penyunting used to
    // contradict it by rendering the criterion in Bahagian 3.
    await page.getByRole("button", { name: /Bahagian 2 · DSKP/ }).click();
    await expect(page.getByText("Kriteria Kejayaan", { exact: true }).first()).toBeVisible();

    // Bahagian 3 is the activity list, in one box rather than a row per name.
    await page.getByRole("button", { name: /Bahagian 3 · PdPc/ }).click();
    await expect(page.getByLabel("Aktiviti PdPC")).toBeVisible();
    await expect(page.getByRole("button", { name: /Tambah aktiviti/ })).toHaveCount(0);

    // Submission lives in Arkib now: the editor only saves, and points the
    // teacher there instead of offering a Hantar button of its own.
    await expect(page.getByRole("button", { name: "Hantar untuk semakan" })).toHaveCount(0);
    await page.getByRole("button", { name: "Hantar melalui Arkib" }).click();
    await expect(page).toHaveURL(/\/arkib/, { timeout: 15_000 });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a submitted RPH opens read-only in the editor", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/arkib");

    const submitted = page.getByRole("listitem").filter({ hasText: "Menunggu GPK" }).first();
    await expect(submitted).toBeVisible({ timeout: 15_000 });
    await submitted.getByRole("button", { name: "Buka", exact: true }).click();

    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+/, { timeout: 15_000 });
    await expect(page.getByText(/Telah dihantar - baca sahaja/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Simpan perubahan/ })).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("review queue decides with the keyboard - sahkan or kembalikan", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/semakan");

    await expect(page.getByRole("heading", { name: "Giliran semakan" })).toBeVisible();
    const before = await page.getByText(/Belum disemak \((\d+)\)/).textContent();

    // `1` = sahkan. There is no longer a Guru Besar to forward to: a GPK
    // approves here, and the Guru Besar does exactly the same thing on any
    // teacher's plan. Local mode skips the signature - there is no database
    // to file it against; synced mode signs first and /api/rpc/review
    // verifies before it will append anything.
    await page.keyboard.press("1");

    await expect(page.getByText(/Disahkan dan ditandatangani/)).toBeVisible({
      timeout: 10_000,
    });
    const after = await page.getByText(/Belum disemak \((\d+)\)/).textContent();
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

  test("an explicit save survives a reload (harness IndexedDB, not component state)", async ({
    page,
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

    // 2. Edit, then save explicitly - keystrokes alone hold nothing now that
    //    autosave is gone, so the save is what the reload must recover.
    const marker = `Refleksi tersimpan ${Date.now()}`;
    await box.fill(marker);
    await expect(box).toHaveValue(marker);
    await page.getByRole("button", { name: /Simpan perubahan/ }).click();
    // The save button is gone once the overlay clears - that is the write
    // landing, not a toast that could come from anywhere.
    await expect(page.getByRole("button", { name: /Simpan perubahan/ })).toHaveCount(0, {
      timeout: 15_000,
    });

    // 3. Reload - the value must come back from the local store, with no
    //    server involved.
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

  test("the penyunting files a real plan", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/editor");
    // The plan penyunting keeps every field: class tick group, week, date,
    // lesson time.
    await expect(page.getByRole("button", { name: /Simpan rancangan/ })).toBeVisible({
      timeout: 15_000,
    });
    // Kelas is a tick group now: one plan may cover several classes.
    await expect(page.getByRole("group", { name: "Kelas" })).toBeVisible();
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

    // Walking away must still have created nothing - no draft on the dashboard.
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
    // in them - a week with nothing filed under it used not to appear here at
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
    // Open the week's node: the plan list lives inside it now.
    const weekBtn = page.getByRole("button", { name: /Minggu 1,/ });
    await weekBtn.click();
    const section = weekBtn.locator("xpath=ancestor::div[2]");
    await expect(section.getByText("0/1")).toBeVisible({ timeout: 15_000 });
    await expect(section.getByRole("button", { name: "Buka", exact: true })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("downloads separate session ZIPs for PDF and DOCX", async ({ page }) => {
    await page.goto("/arkib");
    const button = page.getByRole("button", { name: /Muat turun ZIP sesi/ }).first();
    await expect(button).toBeVisible({ timeout: 15_000 });
    for (const format of ["pdf", "docx"] as const) {
      await button.click();
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        page.getByRole("button", { name: `Muat turun ZIP ${format.toUpperCase()}` }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`-${format.toUpperCase()}\\.zip$`),
      );
      const path = await download.path();
      if (!path) throw new Error("ZIP tidak dimuat turun");
      const names = Object.keys(unzipSync(await readFile(path)));
      expect(names.length).toBeGreaterThan(0);
      expect(names.every((name) => name.endsWith(`.${format}`))).toBe(true);
    }
  });

  test("a whole week of RPH can be copied into another week", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/arkib");

    const copyWeek = page.getByRole("button", { name: /Salin semua RPH minggu/ }).first();
    await expect(copyWeek).toBeVisible({ timeout: 15_000 });
    await copyWeek.click();

    const dialog = page.getByRole("dialog", { name: /Salin RPH minggu/ });
    await expect(dialog).toBeVisible();
    // The destination defaults to the first other week; the clean plans start
    // ticked, so the button names the count.
    const run = dialog.getByRole("button", { name: /^Salin \d+ RPH$/ });
    await expect(run).toBeVisible({ timeout: 15_000 });
    expect(await run.isEnabled()).toBe(true);
    await run.click();

    await expect(dialog.getByText(/\d+ disalin/)).toBeVisible({ timeout: 30_000 });
    await dialog.locator("button").filter({ hasText: "Tutup" }).click();
    await expect(dialog).toBeHidden();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a teacher submits an RPH from the archive, and a week in bulk", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/arkib");

    // Copy a week so the destination holds complete drafts as well as partial
    // ones - the seed's approved plans are complete, its drafts are not.
    await page
      .getByRole("button", { name: /Salin semua RPH minggu/ })
      .first()
      .click();
    const copyDialog = page.getByRole("dialog", { name: /Salin RPH minggu/ });
    const destination = copyDialog.getByLabel("Minggu destinasi");
    const week = Number(await destination.inputValue());
    await copyDialog.getByRole("button", { name: /^Salin \d+ RPH$/ }).click();
    await expect(copyDialog.getByText(/\d+ disalin/)).toBeVisible({ timeout: 30_000 });
    await copyDialog.locator("button").filter({ hasText: "Tutup" }).click();

    // A copy starts with Refleksi cleared, so the first plan has to be finished
    // before it can be sent. Open it from the destination week.
    const openWeek = async () => {
      const button = page.getByRole("button", { name: new RegExp(`Minggu ${week},`) }).first();
      await button.click();
      const row = button.locator("xpath=..");
      return { row, panel: row.locator("xpath=following-sibling::div[1]") };
    };

    const { panel } = await openWeek();
    const firstPlan = panel.getByRole("listitem").first();
    await firstPlan.getByRole("button", { name: "Buka", exact: true }).click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+/, { timeout: 15_000 });
    await page
      .getByRole("button", { name: /Refleksi/ })
      .first()
      .click();
    await page.getByLabel(/Refleksi/).fill("Refleksi selepas disalin.");
    await page.getByRole("button", { name: /Simpan perubahan/ }).click();
    await expect(page.getByRole("button", { name: /Simpan perubahan/ })).toHaveCount(0, {
      timeout: 15_000,
    });

    // Back in the archive, send that one plan.
    await page.goto("/arkib");
    const completed = await openWeek();
    await completed.panel
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: /^Hantar .*untuk semakan$/ })
      .click();
    await expect(page.getByText(/dihantar untuk semakan/)).toBeVisible({ timeout: 15_000 });

    // The rest of the copies still have no reflection. The week is therefore
    // all-or-nothing: the dialog names what is missing and refuses to send
    // anything, rather than quietly submitting the complete half.
    await completed.row
      .getByRole("button", { name: new RegExp(`Hantar semua RPH minggu ${week},`) })
      .click();
    const submitDialog = page.getByRole("dialog", {
      name: new RegExp(`Hantar RPH minggu ${week} untuk semakan`),
    });
    await expect(submitDialog).toBeVisible();
    await expect(submitDialog.getByText(/tidak boleh dihantar kerana/)).toBeVisible();
    await expect(submitDialog.getByText(/Belum diisi:/).first()).toBeVisible();
    await expect(submitDialog.getByRole("button", { name: /^Hantar \d+ RPH$/ })).toBeDisabled();
    await submitDialog.locator("button").filter({ hasText: "Tutup" }).click();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("an existing plan can be copied from the archive", async ({ page }) => {
    const errors = collectErrors(page);

    // 1. Give a seeded draft distinctive content, then file it.
    await page.goto("/minggu");
    await page.getByRole("button", { name: "Sambung" }).first().click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+/, { timeout: 15_000 });
    // 2. Give the plan content the archive can be searched by. A click on
    //    the SSR'd HTML can land before React has attached its handlers, so
    //    the toggle is retried until the section is actually open.
    const dskpToggle = page.getByRole("button", { name: /Bahagian 2 · DSKP/ });
    const skInput = page.getByLabel(/Standard Kandungan/);
    await expect(async () => {
      if ((await dskpToggle.getAttribute("aria-expanded")) !== "true") {
        await dskpToggle.click();
      }
      await expect(skInput).toBeVisible();
    }, "Bahagian 2 opens").toPass({ timeout: 15_000 });

    const marker = `SK salin ${Date.now()}`;
    await skInput.fill(marker);
    // Typing alone writes nothing now (explicit save replaced autosave), so
    // file the marker before leaving for the archive.
    await page.getByRole("button", { name: /Simpan perubahan/ }).click();
    await expect(page.getByRole("button", { name: /Simpan perubahan/ })).toHaveCount(0, {
      timeout: 15_000,
    });

    // 3. Copy it from the archive. Nothing is written yet - the copy opens as
    //    an unsaved draft the teacher can discard. The tree only opens the
    //    branches that match, so searching for the marker is what surfaces it.
    await page.goto("/arkib");
    await page.getByLabel("Cari dalam arkib").fill(marker);
    const source = page.locator("li").filter({ hasText: marker });
    await expect(source.first()).toBeVisible({ timeout: 15_000 });
    await expect(source).toHaveCount(1);
    await source
      .first()
      .getByRole("button", { name: /Tindakan lain/ })
      .click();
    await source.first().getByRole("menuitem", { name: /Salin/ }).click();

    await expect(page).toHaveURL(/\/editor\?copy=[0-9a-f-]+/, { timeout: 15_000 });
    await expect(page.getByText("Belum disimpan")).toBeVisible();

    // The content travels with the copy.
    await expect(async () => {
      if ((await dskpToggle.getAttribute("aria-expanded")) !== "true") {
        await dskpToggle.click();
      }
      await expect(skInput).toBeVisible();
    }, "Bahagian 2 opens on the copy").toPass({ timeout: 15_000 });
    await expect(skInput).toHaveValue(marker);

    // 4. File it on the seed week's free day so the two plans do not collide
    //    on their natural key, then the archive holds both. Bahagian 1 holds
    //    the date, and the copy opens on its first incomplete section, which
    //    is Bahagian 2 - so Profil is opened here the same way.
    const profilToggle = page.getByRole("button", { name: /Bahagian 1 · Profil/ });
    const tarikh = page.getByLabel("Tarikh", { exact: true });
    await expect(async () => {
      if ((await profilToggle.getAttribute("aria-expanded")) !== "true") {
        await profilToggle.click();
      }
      await expect(tarikh).toBeVisible();
    }, "Bahagian 1 opens on the copy").toPass({ timeout: 15_000 });
    await tarikh.fill("2026-03-17");
    await page.getByRole("button", { name: /Simpan rancangan/ }).click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{8}-/, { timeout: 15_000 });

    await page.goto("/arkib");
    await page.getByLabel("Cari dalam arkib").fill(marker);
    await expect(page.locator("li").filter({ hasText: marker })).toHaveCount(2, {
      timeout: 15_000,
    });

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
    await expect(nav.getByRole("link", { name: "Arkib" })).toBeVisible();

    await nav.getByRole("button", { name: "Lagi" }).click();
    const sheet = page.getByRole("dialog", { name: "Lagi" });
    await expect(sheet.getByRole("link", { name: /Direktori RPH/ })).toBeVisible();
    await sheet.getByRole("link", { name: /Direktori RPH/ }).click();
    await expect(page).toHaveURL(/\/direktori-rph/, { timeout: 15_000 });
    await expect(page.getByRole("dialog", { name: "Lagi" })).toBeHidden();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the avatar opens the account menu and signs out on a phone", async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    await page.getByRole("button", { name: "Akaun Rizal bin Abdullah" }).click();
    const menu = page.getByRole("menu", { name: "Akaun" });
    await expect(menu.getByText("Rizal bin Abdullah")).toBeVisible();
    await expect(menu.getByText("Guru Penolong Kanan")).toBeVisible();

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
    // The pending work list comes before the browsing tree, so the first
    // match is the queue row - the tree holds the same plan further down.
    await page
      .getByRole("button", { name: /Ramlan/ })
      .first()
      .click();

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
