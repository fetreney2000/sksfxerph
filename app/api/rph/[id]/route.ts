import { type NextRequest, NextResponse } from "next/server";
import { requireDbUser, schoolIdFor } from "@/lib/server/auth/guard";

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "ID tidak sah" }, { status: 400 });
  }

  const gate = await requireDbUser(request);
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
    console.error("[rph] delete failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json({ ok: true });
}
