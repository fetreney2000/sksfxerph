import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { DocumentRow } from "@/app/api/rph/route";
import { rphPayloadSchema } from "@/lib/schemas/rph";
import { requirePermission, schoolIdFor } from "@/lib/server/auth/guard";
import { toClientError } from "@/lib/server/http/errors";
import { resolveSession } from "@/lib/server/session";

/**
 * DELETE /api/rph/[id] — take a plan out of the archive.
 *
 * Soft, on purpose. `rph_document.deleted_at` exists precisely for this and is
 * annotated "statutory retention": under Peraturan 8, Akta Pendidikan 1996 the
 * plan is a record, so the row stays and the views that read it
 * (`deleted_at is null`) simply stop showing it. The schema already carries the
 * other half of that policy as a commented cron — purge rows soft-deleted for
 * more than five years — so this hides a document now and destroys it later, on
 * a schedule somebody chose, rather than on a mis-tap.
 *
 * `guard_review_fields` is not in the way: it only objects to a change in
 * `status`, `grade` or `reviewed_by`, none of which move here.
 *
 * Ownership is checked explicitly because this handler holds the secret key and
 * bypasses `rph_owner_update` entirely.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The columns a single-plan read returns - the same shape as the list. */
const COLUMNS =
  "id, owner_id, class_ids, subject_code, session, week_no, plan_date, slot_time, " +
  "slot_time_end, status, payload, version, content_hash, created_at, " +
  "updated_at, submitted_at, deleted_at, grade, reviewed_at, " +
  "subject:subject_code(nama), " +
  "rph_review(reviewer:reviewer_id(full_name), comment, created_at)";

/**
 * GET /api/rph/[id] - one of the caller's own plans.
 *
 * What the editor opens: a single row, owner-scoped like the list, so a
 * hand-typed id for a colleague's plan answers 404 rather than leaking its
 * existence. Class names are resolved the same way as the list.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "ID tidak sah" }, { status: 400 });
  }

  const gate = await requirePermission(request, "rph");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });
  }

  const { data, error } = await gate.db
    .from("rph_document")
    .select(COLUMNS)
    .eq("id", id)
    .eq("school_id", schoolId)
    .eq("owner_id", gate.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[rph] read failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "RPH tidak dijumpai" }, { status: 404 });

  const row = data as unknown as DocumentRow;
  const { data: classes } = await gate.db
    .from("class")
    .select("id, nama")
    .eq("school_id", schoolId);
  const names = new Map(
    (classes ?? []).map((c: { id: string; nama: string }) => [c.id, c.nama]),
  );

  return NextResponse.json({
    item: {
      ...row,
      class_names: (row.class_ids ?? []).map((cid) => names.get(cid) ?? ""),
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "ID tidak sah" }, { status: 400 });
  }

  // Writing or deleting a plan is a teacher's act. The ownership check below
  // already limits this to the caller's own rows, but a Guru Besar has no rows
  // of their own to begin with — the permission says so up front.
  const gate = await requirePermission(request, "rph");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId)
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });

  const { data: row, error: readErr } = await gate.db
    .from("rph_document")
    .select("owner_id, deleted_at")
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (readErr) {
    console.error("[rph] delete lookup failed:", readErr.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }
  // 404 for both "not yours" and "already gone": telling a teacher that a
  // document id exists when it is not theirs reveals nothing they may know.
  if (!row || row.owner_id !== gate.user.id || row.deleted_at) {
    return NextResponse.json({ error: "RPH tidak dijumpai" }, { status: 404 });
  }

  const { error } = await gate.db
    .from("rph_document")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", gate.user.id);

  if (error) {
    return toClientError("[rph] delete failed:", error);
  }

  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/rph/[id] - save the teacher's edits to their own plan.
 *
 * Last write wins, on purpose. One teacher owns the row and saves are
 * explicit - there is no background merge to preserve, and the only writer
 * who could collide is the same teacher on another device. The version still
 * bumps on every write so a signature is always over a known version.
 *
 * A sealed plan is closed: once `sahkan_rph` has approved it, the paper that
 * went out must match the row for ever. Drafts, submitted plans awaiting
 * review and returned plans stay editable.
 */
const patchSchema = z
  .object({
    classIds: z.array(z.string().uuid()).min(1).max(30).optional(),
    subjectCode: z.string().min(1).max(12).optional(),
    weekNo: z.number().int().min(1).max(52).optional(),
    planDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarikh tidak sah")
      .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), {
        message: "Tarikh tidak sah",
      })
      .optional(),
    slotTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Masa tidak sah")
      .optional(),
    slotTimeEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Masa tidak sah")
      .optional(),
    payload: rphPayloadSchema.optional(),
    contentHash: z.string().max(128).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Tiada perubahan dihantar" });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "ID tidak sah" }, { status: 400 });
  }

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
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }
  const d = parsed.data;

  const { data: row, error: readErr } = await gate.db
    .from("rph_document")
    .select(
      "owner_id, deleted_at, status, version, class_ids, subject_code, week_no, plan_date",
    )
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (readErr || !row || (row as { owner_id: string }).owner_id !== gate.user.id) {
    if (readErr) console.error("[rph] update lookup failed:", readErr.message);
    const status = readErr ? 500 : 404;
    return NextResponse.json(
      { error: readErr ? "Ralat pelayan." : "RPH tidak dijumpai" },
      { status },
    );
  }
  const current = row as unknown as {
    deleted_at: string | null;
    status: string;
    version: number;
    class_ids: string[];
    subject_code: string;
    week_no: number;
    plan_date: string;
  };
  if (current.deleted_at) {
    return NextResponse.json({ error: "RPH tidak dijumpai" }, { status: 404 });
  }
  if (current.status === "approved") {
    return NextResponse.json(
      { error: "RPH yang telah disahkan tidak boleh diubah." },
      { status: 409 },
    );
  }

  if (d.subjectCode !== undefined) {
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
  }

  if (d.classIds !== undefined) {
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
    // Canonical form, as on create: the unique index compares arrays
    // order-sensitively, so the stored order must not depend on tick order.
    d.classIds = [...new Set(d.classIds)].sort();
    if (!d.classIds.every((id) => schoolClasses.has(id))) {
      return NextResponse.json(
        { error: "Kelas ini bukan milik sekolah atau sesi anda" },
        { status: 422 },
      );
    }
  }

  // Moving the plan to a slot another plan already holds is the same collision
  // as creating into one - only the row itself is exempt. Effective values are
  // the patch over the stored row, so changing only the time still checks the
  // date it already had.
  const effClassIds = d.classIds ?? current.class_ids ?? [];
  const effSubject = d.subjectCode ?? current.subject_code;
  const effWeek = d.weekNo ?? current.week_no;
  const effDate = d.planDate ?? current.plan_date;
  if (
    d.classIds !== undefined ||
    d.subjectCode !== undefined ||
    d.weekNo !== undefined ||
    d.planDate !== undefined
  ) {
    const probe = await gate.db
      .from("rph_document")
      .select("id, class_ids")
      .eq("school_id", schoolId)
      .eq("owner_id", gate.user.id)
      .eq("session", session)
      .eq("week_no", effWeek)
      .eq("plan_date", effDate)
      .eq("subject_code", effSubject)
      .is("deleted_at", null)
      .neq("id", id);
    if (probe.error) {
      return toClientError("[rph] clash lookup failed:", probe.error);
    }
    const hit = ((probe.data ?? []) as { id: string; class_ids: string[] | null }[]).find((r) =>
      (r.class_ids ?? []).some((c) => effClassIds.includes(c)),
    );
    if (hit) {
      return NextResponse.json(
        { error: "Slot ini sudah diisi oleh RPH lain.", clashId: hit.id },
        { status: 409 },
      );
    }
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    client_updated_at: new Date().toISOString(),
    version: current.version + 1,
  };
  if (d.classIds !== undefined) patch.class_ids = d.classIds;
  if (d.subjectCode !== undefined) patch.subject_code = d.subjectCode;
  if (d.weekNo !== undefined) patch.week_no = d.weekNo;
  if (d.planDate !== undefined) patch.plan_date = d.planDate;
  if (d.slotTime !== undefined) patch.slot_time = d.slotTime;
  if (d.slotTimeEnd !== undefined) patch.slot_time_end = d.slotTimeEnd;
  if (d.payload !== undefined) patch.payload = d.payload;
  if (d.contentHash !== undefined) patch.content_hash = d.contentHash;

  const { error } = await gate.db.from("rph_document").update(patch).eq("id", id);
  if (error) {
    // Same race as on create: two saves moving two rows onto the same slot.
    // The overlap probe above would have caught a visible one, so re-probe
    // and report the holder instead of a bare server error.
    if ((error as { code?: string })?.code === "23505") {
      const probe = await gate.db
        .from("rph_document")
        .select("id, class_ids")
        .eq("school_id", schoolId)
        .eq("owner_id", gate.user.id)
        .eq("session", session)
        .eq("week_no", effWeek)
        .eq("plan_date", effDate)
        .eq("subject_code", effSubject)
        .is("deleted_at", null)
        .neq("id", id);
      const hit = ((probe.data ?? []) as { id: string; class_ids: string[] | null }[]).find(
        (r) => (r.class_ids ?? []).some((c) => effClassIds.includes(c)),
      );
      if (!probe.error && hit) {
        return NextResponse.json(
          { error: "Slot ini sudah diisi oleh RPH lain.", clashId: hit.id },
          { status: 409 },
        );
      }
    }
    return toClientError("[rph] update failed:", error);
  }
  return NextResponse.json({ ok: true, version: current.version + 1 });
}
