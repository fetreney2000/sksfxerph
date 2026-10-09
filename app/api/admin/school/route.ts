import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator, schoolIdFor } from "@/lib/server/auth/guard";
import type { adminDb } from "@/lib/server/db";

/**
 * GET / PATCH /api/admin/school — the school's own identity.
 *
 * One multipart PATCH rather than two endpoints: the name, district, motto and
 * crest are a single form in the UI, and splitting them would leave a window
 * where the new name had saved but the new logo had not — or vice versa —
 * giving the sidebar one school and the login screen another.
 *
 * Written through `erph.admin_set_school`, which re-checks
 * `has_role(..., 'pentadbir')` inside the function: this handler holds the
 * secret key, so RLS would not stop it on its own.
 *
 * `kod_sekolah` is read-only here by design. It is `school`'s natural key and
 * it also has to equal `NEXT_PUBLIC_SCHOOL_CODE`, which is baked into the
 * build — letting a form change it would desynchronise the two with no way
 * back.
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
  nama: z.string().min(1, "Nama sekolah diperlukan").max(160),
  ppd: z.string().max(120).nullable(),
  jpn: z.string().max(120).nullable(),
  motto: z.string().max(200).nullable(),
  /** Explicit "keep the current crest" when no file was sent. */
  logo_url: z.string().max(600).nullable(),
});

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

  const parsed = textSchema.safeParse({
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
    p_nama: parsed.data.nama,
    p_ppd: parsed.data.ppd,
    p_jpn: parsed.data.jpn,
    p_motto: parsed.data.motto,
    p_logo_url: logoUrl,
  });
  if (error) {
    console.error("[admin] set school failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  const { data } = await gate.db.from("school").select(COLUMNS).eq("id", gate.schoolId);
  return NextResponse.json({ school: (data?.[0] as SchoolInfo | undefined) ?? null });
}
