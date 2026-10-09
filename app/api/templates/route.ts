import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { SESSION, supabaseConfigured } from "@/lib/config";
import { emptyPayload, type RphPayload, rphPayloadSchema } from "@/lib/schemas/rph";
import { requireDbUser, requireUser, schoolIdFor } from "@/lib/server/auth/guard";
import { adminDb } from "@/lib/server/db";
import type { Curriculum } from "@/lib/types";

/**
 * GET / POST / PATCH / DELETE /api/templates — the school's template library.
 *
 * Reads go through `requireDbUser` (any member) and writes through
 * `requireUser` + an explicit ownership check, because every handler holds the
 * secret key and therefore **bypasses RLS** — `template_update` on
 * `erph.rph_template` would otherwise be decorative. The rule it encodes is
 * reproduced here: you may edit what you own, and the Administrator may edit
 * anything in their school, since curating the library is their job.
 *
 * `owner_id` is always the caller. Allowing one member to file a template under
 * another's name would make `template_update` — which keys on ownership — the
 * only thing standing between them and each other's work.
 */

const COLUMNS =
  "id, school_id, owner_id, title, subject_code, tahap, curriculum, visibility, " +
  "use_count, payload, created_at, owner:owner_id(full_name)";

export interface TemplateRow {
  id: string;
  school_id: string | null;
  owner_id: string | null;
  title: string;
  subject_code: string | null;
  tahap: string | null;
  curriculum: Curriculum | null;
  visibility: "private" | "school" | "system";
  use_count: number;
  payload: RphPayload;
  created_at: string;
  owner: { full_name: string } | null;
}

const createSchema = z.object({
  title: z.string().min(1, "Tajuk templat diperlukan").max(160),
  subjectCode: z.string().max(12).nullable().optional(),
  tahap: z.string().max(40).nullable().optional(),
  curriculum: z.enum(["KSSR", "KSSM", "PRASEKOLAH"]).nullable().optional(),
  visibility: z.enum(["private", "school"]),
  payload: rphPayloadSchema.optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, "Tajuk templat diperlukan").max(160),
  subjectCode: z.string().max(12).nullable().optional(),
  tahap: z.string().max(40).nullable().optional(),
  curriculum: z.enum(["KSSR", "KSSM", "PRASEKOLAH"]).nullable().optional(),
  visibility: z.enum(["private", "school", "system"]),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] });

  // Everything the policy `template_read` would allow, spelled out: your own
  // private ones, anything the school can see, and the system set. `private`
  // rows belonging to colleagues stay invisible.
  const { data, error } = await gate.db
    .from("rph_template")
    .select(COLUMNS)
    .or(
      `school_id.eq.${schoolId},and(school_id.eq.${schoolId},visibility.eq.school),owner_id.eq.${gate.user.id},visibility.eq.system`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[templates] list failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil templat." },
      { status: 500 },
    );
  }
  return NextResponse.json({ items: data ?? [], session: SESSION });
}

async function canEdit(
  request: NextRequest,
  id: string,
): Promise<{ db: ReturnType<typeof adminDb>; userId: string; role: string } | NextResponse> {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "Mod setempat: tiada pangkalan data" }, { status: 503 });
  }

  const schoolId = await schoolIdFor(adminDb(gate.user.id), gate.user.id);
  if (!schoolId)
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });

  const db = adminDb(gate.user.id);
  const { data } = await db
    .from("rph_template")
    .select("id, owner_id, school_id")
    .eq("id", id)
    .maybeSingle();

  if (!data) return NextResponse.json({ error: "Templat tidak dijumpai" }, { status: 404 });

  const row = data as { owner_id: string | null; school_id: string | null };
  const isOwner = row.owner_id === gate.user.id;
  const isAdmin = can(gate.user.role, "pentadbir") && row.school_id === schoolId;
  if (!isOwner && !isAdmin) {
    // 404 rather than 403: telling a stranger a colleague's template exists
    // reveals more than refusing to name it does.
    return NextResponse.json({ error: "Templat tidak dijumpai" }, { status: 404 });
  }

  return { db, userId: gate.user.id, role: gate.user.role };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  if (!supabaseConfigured) {
    return NextResponse.json({ error: "Mod setempat: tiada pangkalan data" }, { status: 503 });
  }

  const schoolId = await schoolIdFor(adminDb(gate.user.id), gate.user.id);
  if (!schoolId)
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });

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

  const d = parsed.data;
  const { data, error } = await adminDb(gate.user.id)
    .from("rph_template")
    .insert({
      school_id: schoolId,
      owner_id: gate.user.id,
      title: d.title,
      subject_code: d.subjectCode ?? null,
      tahap: d.tahap ?? null,
      curriculum: d.curriculum ?? null,
      visibility: d.visibility,
      payload: d.payload ?? emptyTemplatePayload(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[templates] create failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }

  const check = await canEdit(request, parsed.data.id);
  if (check instanceof NextResponse) return check;

  const d = parsed.data;
  const { error } = await check.db.from("rph_template").update({
    title: d.title,
    subject_code: d.subjectCode ?? null,
    tahap: d.tahap ?? null,
    curriculum: d.curriculum ?? null,
    visibility: d.visibility,
  });

  if (error) {
    console.error("[templates] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID tidak sah" }, { status: 400 });
  }

  const check = await canEdit(request, id);
  if (check instanceof NextResponse) return check;

  const { error } = await check.db.from("rph_template").delete().eq("id", id);
  if (error) {
    console.error("[templates] delete failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * The starting payload for a template created from the form.
 *
 * Deliberately empty rather than invented: a template is a *starting point*,
 * and pre-filling it with plausible-looking Malay prose would mean every plan
 * a teacher began from it carried text they did not write until they noticed.
 * Real content arrives when someone saves an existing RPH as a template.
 */
function emptyTemplatePayload(): RphPayload {
  return emptyPayload();
}
