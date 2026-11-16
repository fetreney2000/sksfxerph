import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rphPayloadSchema } from "@/lib/schemas/rph";
import { requirePermission, schoolIdFor } from "@/lib/server/auth/guard";
import { dbFailureMessage, toClientError } from "@/lib/server/http/errors";
import { resolveSession } from "@/lib/server/session";

/**
 * GET /api/rph - the caller's own plans.
 *
 * Documents have always gone *up* and nothing has ever been pulled *down*,
 * so a plan only existed in the browser that created it: the same teacher on a
 * second device saw an empty archive, and the seal - which is rendered from
 * the local document - could not appear at all. This is the other half.
 *
 * Scoped to the caller's own rows rather than filtered in the client. This
 * handler holds the secret key and bypasses RLS, so anything not excluded here
 * is readable; `owner_id` is the only condition that matters and it is applied
 * in the query, not afterwards.
 *
 * Deliberately not a "pull everything and reconcile" endpoint: reviewers get
 * plans through `/api/queue` and teachers through `pantau_teachers`, and both
 * are scoped differently. This is the teacher's own archive and nothing else.
 */
export interface DocumentRow {
  id: string;
  /** Written into the local copy, so IndexedDB can tell two accounts apart. */
  owner_id: string;
  /** The classes this plan covers - sorted, distinct (the server's canonical form). */
  class_ids: string[];
  subject_code: string;
  session: string;
  week_no: number;
  plan_date: string;
  slot_time: string | null;
  slot_time_end: string | null;
  status: string;
  payload: unknown;
  version: number;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  deleted_at: string | null;
  grade: number | null;
  reviewed_at: string | null;
  /** Parallel to class_ids, resolved from the school's class list below. */
  class_names: string[];
  subject: { nama: string } | null;
  /** Every review this plan has had; the caller takes the newest one. */
  rph_review?:
    | {
        reviewer?: { full_name: string } | null;
        comment: string | null;
        created_at: string;
      }[]
    | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePermission(request, "rph");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] as DocumentRow[] });

  const { data, error } = await gate.db
    .from("rph_document")
    .select(
      "id, owner_id, class_ids, subject_code, session, week_no, plan_date, slot_time, " +
        "slot_time_end, status, payload, version, content_hash, created_at, " +
        "updated_at, submitted_at, deleted_at, grade, reviewed_at, " +
        "subject:subject_code(nama), " +
        // The reviewer's catatan and their name, from the same row. One-to-many
        // - a plan can be returned and re-reviewed - so the whole set comes
        // across and the caller takes the newest, rather than the server
        // guessing which one a reader wants.
        "rph_review(reviewer:reviewer_id(full_name), comment, created_at)",
    )
    .eq("school_id", schoolId)
    .eq("owner_id", gate.user.id)
    // Soft-deleted rows stay in the database as statutory records, but the
    // archive must not list what the teacher removed: there is no local
    // mirror left to delete them from, so the exclusion lives here.
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[rph] pull failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  // PostgREST cannot embed `class.nama` through an array column (`class_ids`
  // has no FK), so the names are resolved here: one extra read of the school's
  // class list, then a map. A plan naming a class that has since been archived
  // keeps its name - the map simply has to include inactive rows to do that.
  const { data: classes } = await gate.db
    .from("class")
    .select("id, nama")
    .eq("school_id", schoolId);
  const names = new Map(
    (classes ?? []).map((c: { id: string; nama: string }) => [c.id, c.nama]),
  );

  const raw = (data ?? []) as unknown as DocumentRow[];
  const rows = raw.map((row) => ({
    ...row,
    class_names: (row.class_ids ?? []).map((id) => names.get(id) ?? ""),
  }));

  return NextResponse.json({ items: rows });
}

/**
 * POST /api/rph - file a new plan.
 *
 * Online-only writes: the editor keeps unsaved work in React state and only
 * calls here when the teacher presses Simpan, so every row in the database is
 * a plan somebody chose to write - no blank drafts, no sync queue, no merge
 * step. The server owns identity, session and version: the school comes from
 * the caller's membership and the session from `school_setting`, never from
 * the request body, because a teacher must not be able to file their plan
 * under another school or year.
 *
 * The natural key is checked before the insert, the same overlap rule the old
 * sync path enforced: a second plan for the same slot coexists only where
 * both claim a shared class. A clash is a 409 naming the existing plan, so
 * the editor can offer it instead of silently becoming someone else's row.
 */
const createSchema = z.object({
  classIds: z.array(z.string().uuid()).min(1).max(30),
  subjectCode: z.string().min(1).max(12),
  weekNo: z.number().int().min(1).max(52),
  planDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarikh tidak sah")
    .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), {
      message: "Tarikh tidak sah",
    }),
  slotTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Masa tidak sah"),
  slotTimeEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Masa tidak sah")
    .optional(),
  payload: rphPayloadSchema,
  contentHash: z.string().max(128).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePermission(request, "rph");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });
  }
  const session = await resolveSession(gate.user.id);

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

  // Canonical form: sorted and de-duplicated. The schema's unique index
  // compares `class_ids` as arrays (order-sensitive), and the old sync path
  // sorted before writing - an unsorted insert would slip past the index and
  // file the same slot twice under two orders.
  const classIds = [...new Set(d.classIds)].sort();

  // The classes must be the school's own, for this session, and active: a
  // plan filed under another school's class would be invisible everywhere
  // and ungradeable anywhere. Same rule the old sync path enforced.
  const { data: classes, error: classErr } = await gate.db
    .from("class")
    .select("id")
    .eq("school_id", schoolId)
    .eq("session", session)
    .eq("is_active", true);
  if (classErr) {
    console.error("[rph] class lookup failed:", classErr.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }
  const schoolClasses = new Set((classes ?? []).map((c: { id: string }) => c.id));
  if (!classIds.every((id) => schoolClasses.has(id))) {
    return NextResponse.json(
      { error: "Kelas ini bukan milik sekolah atau sesi anda" },
      { status: 422 },
    );
  }

  // The subject must exist: the cover sheet and the DSKP lookups join on its
  // code, and a typo would file a plan nobody's report can name.
  const { data: subject, error: subjectErr } = await gate.db
    .from("subject")
    .select("code")
    .eq("code", d.subjectCode)
    .maybeSingle();
  if (subjectErr) {
    console.error("[rph] subject lookup failed:", subjectErr.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }
  if (!subject) {
    return NextResponse.json({ error: "Subjek tidak sah." }, { status: 422 });
  }

  // The natural-key clash check, before the insert rather than after it: a
  // second plan for the same teacher, subject, week and day that shares a
  // class is the same slot taught twice, and the first filing wins.
  const { data: clash, error: clashErr } = await gate.db
    .from("rph_document")
    .select("id, class_ids")
    .eq("school_id", schoolId)
    .eq("owner_id", gate.user.id)
    .eq("session", session)
    .eq("week_no", d.weekNo)
    .eq("plan_date", d.planDate)
    .eq("subject_code", d.subjectCode)
    .is("deleted_at", null);
  if (clashErr) {
    // A failed read before any write: name the infrastructure cause when it
    // is a known one, so a stale database does not masquerade as a bug.
    const known = dbFailureMessage(clashErr);
    if (known) return NextResponse.json({ error: known }, { status: 422 });
    return toClientError("[rph] clash lookup failed:", clashErr);
  }
  const hit = ((clash ?? []) as { id: string; class_ids: string[] }[]).find((row) =>
    (row.class_ids ?? []).some((c) => classIds.includes(c)),
  );
  if (hit) {
    return NextResponse.json(
      { error: "Anda sudah mempunyai RPH untuk slot ini.", clashId: hit.id },
      { status: 409 },
    );
  }

  const { data, error } = await gate.db
    .from("rph_document")
    .insert({
      school_id: schoolId,
      owner_id: gate.user.id,
      class_ids: classIds,
      subject_code: d.subjectCode,
      session,
      week_no: d.weekNo,
      plan_date: d.planDate,
      slot_time: d.slotTime,
      slot_time_end: d.slotTimeEnd ?? d.slotTime,
      payload: d.payload,
      content_hash: d.contentHash ?? null,
      status: "draft",
      version: 1,
    })
    .select("id")
    .single();

  if (error) {
    // Exact-duplicate race: two presses in flight can both pass the clash
    // check above, and the unique index catches the second. That is not a
    // failure - the plan exists, so hand it back the way the 409 path does
    // and the editor opens it instead of showing an error.
    if ((error as { code?: string })?.code === "23505") {
      const retry = await gate.db
        .from("rph_document")
        .select("id, class_ids")
        .eq("school_id", schoolId)
        .eq("owner_id", gate.user.id)
        .eq("session", session)
        .eq("week_no", d.weekNo)
        .eq("plan_date", d.planDate)
        .eq("subject_code", d.subjectCode)
        .is("deleted_at", null);
      const retryHit = ((retry.data ?? []) as { id: string; class_ids: string[] }[]).find(
        (row) => (row.class_ids ?? []).some((c) => classIds.includes(c)),
      );
      if (!retry.error && retryHit) {
        return NextResponse.json(
          { error: "Anda sudah mempunyai RPH untuk slot ini.", clashId: retryHit.id },
          { status: 409 },
        );
      }
    }
    const known = dbFailureMessage(error);
    if (known) return NextResponse.json({ error: known }, { status: 422 });
    return toClientError("[rph] create failed:", error);
  }
  return NextResponse.json({ ok: true, id: (data as { id: string }).id, version: 1 });
}
