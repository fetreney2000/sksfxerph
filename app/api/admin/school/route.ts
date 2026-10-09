import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator, schoolIdFor } from "@/lib/server/auth/guard";
import type { adminDb } from "@/lib/server/db";

/**
 * GET / PATCH /api/admin/school — the school's own identity.
 *
 * One multipart PATCH rather than two endpoints: the code, name, district,
 * motto and crest are a single form in the UI, and splitting them would leave a
 * window where the new name had saved but the new crest had not — or vice
 * versa — giving the sidebar one school and the login screen another.
 *
 * Written through `erph.admin_set_school`, which re-checks
 * `has_role(..., 'pentadbir')` inside the function: this handler holds the
 * secret key, so RLS would not stop it on its own.
 *
 * ## Why the school code is writable
 *
 * It is `school`'s UNIQUE natural key, so it looks like the one field that must
 * not move. It isn't: nothing in the database references it — `school_id` is
 * the foreign key on `rph_document`, `class`, `school_member` and every other
 * table — and `sync_rph` derives the school from `class_id`. The single place
 * that ever looked a school up *by* its code was `resolveSchool()`, and that
 * now reads the active row instead, precisely so this field can be edited
 * without stranding the branding on a code no row has any more.
 *
 * Validation is duplicated here rather than left to SQL so the common case —
 * an admin typing a code with a space in it — is answered in the form, without
 * a round trip, in the same message the server would have given.
 */

/** What the tab renders. */
export interface SchoolInfo {
  id: string;
  kod_sekolah: string;
  nama: string;
  level: string;
  ppd: string | null;
  jpn: string | null;
  motto: string | null;
  logo_url: string | null;
}

const COLUMNS = "id, kod_sekolah, nama, level, ppd, jpn, motto, logo_url";

/**
 * Raster only, and small.
 *
 * SVG is refused rather than sanitised: a crest is not worth the surface area,
 * `next/image` does not need it, and an administrator-supplied SVG that reaches
 * an `<img src>` is a stored-XSS shape this app has no reason to carry.
 */
const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const textSchema = z.object({
  // Trimming happens before validation so a stray space is corrected rather
  // than rejected — but a code that is *only* whitespace still has to fail.
  kod_sekolah: z
    .string()
    .min(1, "Kod sekolah diperlukan")
    .max(24, "Kod sekolah terlalu panjang (maksimum 24 aksara)")
    // Mirrors the check in `erph.admin_set_school` — same pattern, same words,
    // so the form and the server can never disagree about what is allowed.
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      "Kod sekolah: huruf, nombor, titik, - atau _ sahaja",
    ),
  nama: z.string().min(1, "Nama sekolah diperlukan").max(160),
  ppd: z.string().max(120).nullable(),
  jpn: z.string().max(120).nullable(),
  motto: z.string().max(200).nullable(),
  /** Explicit "keep the current crest" when no file was sent. */
  logo_url: z.string().max(600).nullable(),
});

/**
 * Postgres' and PostgREST's error text describes the schema — table names,
 * constraints, function signatures — and none of it means anything to a person
 * filling in a form. Every message `admin_set_school` raises *on purpose* is
 * Malay prose and matches none of these markers, so anything that does is a
 * database wearing a user-facing label: a real constraint failure, or a
 * deployment that has not run its migration yet ("could not find the function
 * … in the schema cache"), which the operator sees in full in the server log.
 */
const INTERNAL_ERROR =
  /\b(duplicate key|null value|violates|relation|constraint|column|syntax|permission denied|value too long|foreign key|does not exist|schema cache|could not find the function)\b/i;

function formError(message: string): string {
  // The one failure an administrator can actually fix from this page, and the
  // state this deployment is in between shipping the code and running the
  // migration. PostgREST would otherwise hand them "could not find the
  // function erph.admin_set_school(p_jpn, p_kod_sekolah, …) in the schema
  // cache" — a schema dump for a problem with a one-line remedy, which the
  // server log still records in full.
  if (/schema cache|could not find the function/i.test(message)) {
    return "Simpan gagal: pangkalan data belum dikemas kini. Jalankan db/migrations/003_school_identity.sql terlebih dahulu.";
  }
  if (INTERNAL_ERROR.test(message)) {
    return "Maklumat sekolah tidak sah. Sila semak semula.";
  }
  return message;
}

/**
 * Administrator + school, or the response to send back. The two arms must be
 * genuinely disjoint — if both mention `error`, `"error" in gate` narrows to
 * nothing useful and `gate.error` arrives as `NextResponse | undefined`.
 */
type AdminGate = { error: NextResponse } | { db: ReturnType<typeof adminDb>; schoolId: string };

async function adminGate(request: NextRequest): Promise<AdminGate> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return { error: gate.error };
  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return { error: NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 }) };
  }
  return { db: gate.db, schoolId };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await adminGate(request);
  if ("error" in gate) return gate.error;

  const { data, error } = await gate.db.from("school").select(COLUMNS).eq("id", gate.schoolId);
  if (error) {
    console.error("[admin] school read failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan semasa." }, { status: 500 });
  }
  return NextResponse.json({ school: (data?.[0] as SchoolInfo | undefined) ?? null });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const gate = await adminGate(request);
  if ("error" in gate) return gate.error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Borang tidak sah" }, { status: 400 });
  }

  const rawCode = form.get("kod_sekolah");
  const parsed = textSchema.safeParse({
    kod_sekolah: typeof rawCode === "string" ? rawCode.trim() : "",
    nama: form.get("nama"),
    ppd: form.get("ppd") || null,
    jpn: form.get("jpn") || null,
    motto: form.get("motto") || null,
    logo_url: form.get("logo_url") || null,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }

  let logoUrl = parsed.data.logo_url;

  const file = form.get("logo");
  if (file !== null && typeof file !== "string") {
    if (!ACCEPTED.has(file.type)) {
      return NextResponse.json(
        { error: "Logo mesti fail PNG, JPG atau WebP" },
        { status: 422 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Logo melebihi 2 MB" }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    // Fixed path + upsert: the school has exactly one crest, so a re-upload
    // replaces it instead of accumulating an orphan in the bucket on every try.
    const path = `${gate.schoolId}/logo.${EXT[file.type] ?? "png"}`;
    const { error: upErr } = await gate.db.storage
      .from("school-assets")
      .upload(path, bytes, { contentType: file.type, upsert: true });
    if (upErr) {
      console.error("[admin] logo upload failed:", upErr.message);
      return NextResponse.json({ error: "Gagal memuat naik logo." }, { status: 502 });
    }
    logoUrl = gate.db.storage.from("school-assets").getPublicUrl(path).data.publicUrl;
  }

  const { error } = await gate.db.rpc("admin_set_school", {
    p_school: gate.schoolId,
    p_kod_sekolah: parsed.data.kod_sekolah,
    p_nama: parsed.data.nama,
    p_ppd: parsed.data.ppd,
    p_jpn: parsed.data.jpn,
    p_motto: parsed.data.motto,
    p_logo_url: logoUrl,
  });
  if (error) {
    console.error("[admin] set school failed:", error.message);
    return NextResponse.json({ error: formError(error.message) }, { status: 422 });
  }

  const { data } = await gate.db.from("school").select(COLUMNS).eq("id", gate.schoolId);
  return NextResponse.json({ school: (data?.[0] as SchoolInfo | undefined) ?? null });
}
