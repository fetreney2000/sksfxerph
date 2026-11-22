import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { DocumentRow } from "@/app/api/rph/route";
import { can } from "@/lib/auth/permissions";
import { weekOfIso } from "@/lib/config";
import { hashPayload } from "@/lib/hash";
import { completeness, normalisePayload, rphPayloadSchema } from "@/lib/schemas/rph";
import { requireDbUser, requirePermission, schoolIdFor } from "@/lib/server/auth/guard";
import { loadCalendarAnchors } from "@/lib/server/calendar";
import { dbFailureMessage, toClientError } from "@/lib/server/http/errors";
import { currentSession } from "@/lib/session";

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
  // The reader is not always the writer: a reviewer opening "Buka penuh"
  // needs the name on the paper, and the queue already proves this embed.
  "owner:owner_id(full_name), " +
  "rph_review(reviewer:reviewer_id(full_name), comment, created_at)";

/**
 * GET /api/rph/[id] - one plan, read by its owner or its reviewer.
 *
 * Owners read their own rows (the `rph` permission), exactly as before - a
 * hand-typed id for a colleague's plan answers 404 rather than leaking its
 * existence. Reviewers (`semak`) read the rows they may decide: the whole
 * school for a Guru Besar, the assigned teachers for a GPK - the same scope
 * `/api/queue` applies. This is what "Buka penuh" on Semakan opens: the
 * editor stays owner-only, so review reads needed their own door.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "ID tidak sah" }, { status: 400 });
  }

  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;
  const teacher = can(gate.user.role, "rph");
  const reviewer = can(gate.user.role, "semak");
  if (!teacher && !reviewer) {
    return NextResponse.json({ error: "Peranan anda tidak mencukupi" }, { status: 403 });
  }

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });
  }

  const { data, error } = await gate.db
    .from("rph_document")
    .select(COLUMNS)
    .eq("id", id)
    .eq("school_id", schoolId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[rph] read failed:", error.message);
    const known = dbFailureMessage(error);
    if (known) return NextResponse.json({ error: known }, { status: 422 });
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }
  const row = data as unknown as
    | (DocumentRow & { owner?: { full_name: string } | null })
    | null;
  if (!row) return NextResponse.json({ error: "RPH tidak dijumpai" }, { status: 404 });

  // Their own row needs the teaching permission; anyone else's needs the
  // reviewing one *and* the scope - same rule as the queue, so a GPK cannot
  // open a plan assigned to nobody by guessing its id.
  const ownOk = row.owner_id === gate.user.id && teacher;
  let scopeOk = false;
  if (!ownOk && reviewer) {
    if (gate.user.role === "guru_besar") {
      scopeOk = true;
    } else {
      const { data: supervised, error: scopeErr } = await gate.db
        .from("school_member")
        .select("user_id")
        .eq("school_id", schoolId)
        .eq("supervisor_id", gate.user.id)
        .eq("is_active", true);
      if (scopeErr) {
        console.error("[rph] scope lookup failed:", scopeErr.message);
        const known = dbFailureMessage(scopeErr);
        if (known) return NextResponse.json({ error: known }, { status: 422 });
        return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
      }
      scopeOk = ((supervised ?? []) as { user_id: string }[]).some(
        (m) => m.user_id === row.owner_id,
      );
    }
  }
  if (!ownOk && !scopeOk) {
    return NextResponse.json({ error: "RPH tidak dijumpai" }, { status: 404 });
  }

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
    teacherName: row.owner?.full_name ?? "Guru",
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
    .select("owner_id, deleted_at, status")
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
  // A filed plan is no longer the teacher's alone to withdraw silently: an
  // approved plan is a sealed statutory record, and a submitted one may be
  // sitting open on a reviewer's screen. Drafts and returned plans are still
  // the teacher's working copies, so those may go.
  const status = (row as { status?: string }).status;
  if (status === "approved") {
    return NextResponse.json(
      { error: "RPH yang telah disahkan tidak boleh dikeluarkan." },
      { status: 409 },
    );
  }
  if (status === "submitted") {
    return NextResponse.json(
      { error: "RPH yang sedang disemak tidak boleh dikeluarkan. Tunggu keputusan semakan." },
      { status: 409 },
    );
  }

  // Ownership was verified by the lookup above, so the id alone identifies
  // the row - and a row that changed hands in between answers 404 there.
  const { error } = await gate.db
    .from("rph_document")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return toClientError("[rph] delete failed:", error);
  }

  // Every other write leaves a trail - a deletion that did not would let a
  // filed plan vanish without a trace of who withdrew it.
  const { error: auditErr } = await gate.db.from("audit_log").insert({
    school_id: schoolId,
    actor_id: gate.user.id,
    entity: "rph_document",
    entity_id: id,
    action: "delete",
    after: { status: status ?? null },
  });
  if (auditErr) {
    console.error("[rph] delete audit failed:", auditErr.message);
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
 * Only a teacher's working copies - drafts and returned plans - are editable.
 * A submitted plan belongs to the reviewer until they decide: editing it under
 * them would change what they are reading, and moving its date or week could
 * back-date a current filing into a past week the reviewer may approve at once.
 * An approved plan is a sealed record and never changes.
 */
const patchSchema = z
  .object({
    classIds: z
      .array(z.string().uuid())
      .min(1, "Pilih sekurang-kurangnya satu kelas")
      .max(30)
      .optional(),
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
    /** The version the editor loaded; a mismatch means another tab saved first. */
    expectedVersion: z.number().int().min(1).optional(),
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
      "owner_id, deleted_at, status, version, class_ids, subject_code, session, week_no, plan_date, payload",
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
    session: string;
    week_no: number;
    plan_date: string;
    payload: unknown;
  };
  if (current.deleted_at) {
    return NextResponse.json({ error: "RPH tidak dijumpai" }, { status: 404 });
  }
  if (current.status !== "draft" && current.status !== "returned") {
    return NextResponse.json(
      {
        error:
          current.status === "approved"
            ? "RPH yang telah disahkan tidak boleh diubah."
            : "RPH yang telah dihantar untuk semakan tidak boleh diubah. Tunggu keputusan penyemak.",
      },
      { status: 409 },
    );
  }
  if (d.expectedVersion !== undefined && d.expectedVersion !== current.version) {
    return NextResponse.json(
      {
        error:
          "RPH ini telah disimpan pada peranti atau tab lain. Muat semula sebelum menyimpan semula.",
      },
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
    // Canonical form, as on create: the unique index compares arrays
    // order-sensitively, so the stored order must not depend on tick order.
    d.classIds = [...new Set(d.classIds)].sort();

    // An unchanged class set is always acceptable. This is what lets a plan
    // from an earlier session be edited at all: its classes belong to that
    // session's rows, not to the school's current one.
    const currentIds = current.class_ids ?? [];
    const unchanged =
      d.classIds.length === currentIds.length &&
      d.classIds.every((id, index) => id === currentIds[index]);

    if (!unchanged) {
      const { data: classes, error: classErr } = await gate.db
        .from("class")
        .select("id")
        .eq("school_id", schoolId)
        .eq("session", current.session)
        .eq("is_active", true);
      if (classErr) {
        console.error("[rph] class lookup failed:", classErr.message);
        return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
      }
      const schoolClasses = new Set((classes ?? []).map((c: { id: string }) => c.id));
      if (!d.classIds.every((id) => schoolClasses.has(id))) {
        return NextResponse.json(
          { error: "Kelas ini bukan milik sekolah atau sesi RPH ini" },
          { status: 422 },
        );
      }
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
  const weekDateChanged =
    (d.weekNo !== undefined && d.weekNo !== current.week_no) ||
    (d.planDate !== undefined && d.planDate !== current.plan_date);
  if (weekDateChanged) {
    // Week numbers belong to the session's calendar. Moving a historical plan
    // would compare it against this year's anchors and could silently file it
    // somewhere else; leave its slot alone.
    if (current.session !== currentSession()) {
      return NextResponse.json(
        { error: "RPH sesi lama tidak boleh dipindahkan ke minggu lain." },
        { status: 422 },
      );
    }
    const anchors = await loadCalendarAnchors(schoolId);
    if (weekOfIso(effDate, anchors) !== effWeek) {
      return NextResponse.json(
        { error: "Tarikh tidak sepadan dengan minggu yang dipilih." },
        { status: 422 },
      );
    }
  }
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
      .eq("session", current.session)
      .eq("week_no", effWeek)
      .eq("plan_date", effDate)
      .eq("subject_code", effSubject)
      .is("deleted_at", null)
      .neq("id", id);
    if (probe.error) {
      const known = dbFailureMessage(probe.error);
      if (known) return NextResponse.json({ error: known }, { status: 422 });
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

  const version = current.version + 1;
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    client_updated_at: new Date().toISOString(),
    version,
  };
  if (d.classIds !== undefined) patch.class_ids = d.classIds;
  if (d.subjectCode !== undefined) patch.subject_code = d.subjectCode;
  if (d.weekNo !== undefined) patch.week_no = d.weekNo;
  if (d.planDate !== undefined) patch.plan_date = d.planDate;
  if (d.slotTime !== undefined) patch.slot_time = d.slotTime;
  if (d.slotTimeEnd !== undefined) patch.slot_time_end = d.slotTimeEnd;
  if (d.payload !== undefined) {
    patch.payload = d.payload;
    // Derived, never trusted from the body.
    patch.content_hash = hashPayload(d.payload);
  }

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
        .eq("session", current.session)
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
    const known = dbFailureMessage(error);
    if (known) return NextResponse.json({ error: known }, { status: 422 });
    return toClientError("[rph] update failed:", error);
  }
  // Keep the edit history the schema promises. A revision row belongs to the
  // version just written, so the payload is the effective one - either the
  // patched body or the row's existing content.
  const effective = d.payload ?? normalisePayload(current.payload);
  const { error: revisionErr } = await gate.db.from("rph_revision").insert({
    document_id: id,
    version,
    payload: effective,
    completeness: completeness(effective),
    actor_id: gate.user.id,
    reason: "edit",
  });
  if (revisionErr) {
    console.error("[rph] revision write failed:", revisionErr.message);
  }

  return NextResponse.json({ ok: true, version });
}
