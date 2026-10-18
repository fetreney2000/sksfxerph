import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator, schoolIdFor } from "@/lib/server/auth/guard";
import type { adminDb } from "@/lib/server/db";

/**
 * GET / POST / PATCH /api/admin/subjects — the administrator's view of the
 * subject list: everything, active or not, with the plan count each carries.
 *
 * Split from `GET /api/subjects` because they answer different questions —
 * "what may a teacher pick?" versus "what does this school teach, and how much
 * work sits against each?". The count is what turns `is_active` from a switch
 * into a decision.
 *
 * Nothing here ever deletes. `rph_document.subject_code` and
 * `dskp_standard.subject_code` both reference `erph.subject`, so a removal
 * would take every plan already written against it.
 *
 * Writes go through `erph.admin_set_subject` / `erph.admin_create_subject`,
 * which re-check `has_role(..., 'pentadbir')` inside the function — this
 * handler holds the secret key, so RLS would not stop it on its own.
 */

/**
 * Matikan/Hidupkan, or correcting a subject that already exists — one shape,
 * told apart by which field came in.
 *
 * `code` is never editable: it is a foreign key on every plan, DSKP standard
 * and teaching assignment, so the two things that *can* be wrong with a
 * subject — what it is called, and which curriculum it belongs to — are the
 * two this accepts.
 */
const patchSchema = z
  .object({
    code: z.string().min(1).max(12),
    isActive: z.boolean().optional(),
    nama: z.string().min(1, "Nama mata pelajaran diperlukan").max(80).optional(),
    curriculum: z.enum(["KSSR", "KSSM", "PRASEKOLAH"]).optional(),
  })
  .refine((d) => d.nama !== undefined || d.isActive !== undefined, {
    message: "Tiada perubahan diminta",
  });

const createSchema = z.object({
  code: z
    .string()
    .min(2, "Kod subjek: sekurang-kurangnya 2 aksara")
    .max(12, "Kod subjek: maksimum 12 aksara")
    .regex(/^[A-Za-z0-9]{2,12}$/, "Kod subjek: huruf besar atau nombor sahaja"),
  nama: z.string().min(1, "Nama mata pelajaran diperlukan").max(80),
  curriculum: z.enum(["KSSR", "KSSM", "PRASEKOLAH"]),
});

/**
 * Administrator + school, or the response to send back.
 *
 * The two arms must be genuinely disjoint for `"error" in gate` to narrow: the
 * moment arm two carries `error?: undefined`, TypeScript still sees the property
 * as present-but-possibly-undefined and `gate.error` arrives as
 * `NextResponse | undefined` — which is exactly the error this replaced. Arm two
 * therefore does not mention `error` at all.
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

  const { data, error } = await gate.db.rpc("admin_list_subjects", {
    p_school: gate.schoolId,
  });
  if (error) {
    console.error("[admin] list subjects failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil mata pelajaran." },
      { status: 500 },
    );
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await adminGate(request);
  if ("error" in gate) return gate.error;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }

  const { error } = await gate.db.rpc("admin_create_subject", {
    p_school: gate.schoolId,
    p_code: parsed.data.code.toUpperCase(),
    p_nama: parsed.data.nama,
    p_curriculum: parsed.data.curriculum,
  });
  if (error) {
    console.error("[admin] create subject failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const gate = await adminGate(request);
  if ("error" in gate) return gate.error;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }
  const body = parsed.data;

  if (body.nama !== undefined) {
    // Both halves or neither: a name with no curriculum would silently put a
    // subject back under the wrong syllabus.
    if (body.curriculum === undefined) {
      return NextResponse.json({ error: "Kurikulum diperlukan" }, { status: 422 });
    }
    const { error } = await gate.db.rpc("admin_edit_subject", {
      p_school: gate.schoolId,
      p_code: body.code,
      p_nama: body.nama,
      p_curriculum: body.curriculum,
    });
    if (error) {
      console.error("[admin] edit subject failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.isActive === undefined) {
    return NextResponse.json({ error: "Tiada perubahan diminta" }, { status: 422 });
  }
  const { error } = await gate.db.rpc("admin_set_subject", {
    p_school: gate.schoolId,
    p_code: body.code,
    p_active: body.isActive,
  });
  if (error) {
    console.error("[admin] set subject failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
