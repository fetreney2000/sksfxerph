import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser, requirePermission, schoolIdFor } from "@/lib/server/auth/guard";
import { resolveSession } from "@/lib/server/session";

/**
 * GET / POST / DELETE /api/rpt - a teacher's RPT links.
 *
 * The file bytes never touch this database: an RPT lives in the teacher's own
 * Google Drive and only the link is stored here, titled per subject, so a GPK
 * or Guru Besar can open and check it. Server-only: there is no Dexie
 * store and no sync op, because a link to Drive is only usable online
 * anyway, and in local mode there are no reviewers to show it to.
 *
 * Writes are gated on `rph`: a Guru Besar teaches no class and holds no plans,
 * so they have nothing to attach - reviewers read through
 * `/api/pantau/teachers`, which is already scoped to the teachers they may
 * see. Every handler holds the secret key and bypasses RLS, so the ownership
 * rule is spelled out here too rather than trusted to the policy.
 */

export interface RptLink {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
}

/** Hosts a teacher may link to - Drive files and folders, Docs/Sheets/Slides. */
const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

/** Literal match through `ilike`: a title of `%` must name itself, not every row. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

const attachSchema = z.object({
  title: z.string().trim().min(1, "Tajuk diperlukan").max(120),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine(
      (value) => {
        let host: string;
        try {
          const parsed = new URL(value);
          if (parsed.protocol !== "https:") return false;
          host = parsed.hostname.toLowerCase();
        } catch {
          return false;
        }
        return DRIVE_HOSTS.has(host);
      },
      { message: "Pautan Google Drive sahaja (drive.google.com)." },
    ),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] as RptLink[] });

  const session = await resolveSession(gate.user.id);

  const { data, error } = await gate.db
    .from("rpt_link")
    .select("id, title, url, updated_at")
    .eq("school_id", schoolId)
    .eq("owner_id", gate.user.id)
    .eq("session", session)
    .order("title", { ascending: true });

  if (error) {
    console.error("[rpt] list failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan semasa mengambil RPT." }, { status: 500 });
  }

  const items: RptLink[] = ((data ?? []) as unknown as Record<string, unknown>[]).map(
    (row) => ({
      id: String(row.id),
      title: String(row.title),
      url: String(row.url),
      updatedAt: String(row.updated_at),
    }),
  );
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
  const parsed = attachSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }

  const session = await resolveSession(gate.user.id);

  // The row holding this title for this teacher and session, if any.
  // Matched the same way the unique index compares: case-insensitively, so
  // "RPT Matematik" and "rpt matematik" are one row, not two.
  const findByTitle = async (
    title: string,
  ): Promise<{ id: string | null; error: { message: string } | null }> => {
    const { data, error } = await gate.db
      .from("rpt_link")
      .select("id")
      .eq("school_id", schoolId)
      .eq("owner_id", gate.user.id)
      .eq("session", session)
      .ilike("title", escapeLike(title))
      .limit(1)
      .maybeSingle();
    if (error) return { id: null, error: { message: error.message } };
    return { id: (data as { id: string } | null)?.id ?? null, error: null };
  };

  // One row per (teacher, session, title): re-attaching the same subject's
  // RPT updates the link rather than stacking a second row for the reviewer
  // to guess between. An explicit update-or-insert rather than `upsert`,
  // because the uniqueness is on `lower(title)` - an expression index PostgREST
  // cannot name as an upsert arbiter.
  const found = await findByTitle(parsed.data.title);
  if (found.error) {
    console.error("[rpt] lookup failed:", found.error.message);
    return NextResponse.json({ error: "Ralat pelayan semasa menyimpan RPT." }, { status: 500 });
  }

  const row = found.id ? { id: found.id } : null;
  const updateUrl = async (id: string) =>
    gate.db
      .from("rpt_link")
      .update({ url: parsed.data.url, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", gate.user.id)
      .select("id")
      .single();
  const write = row
    ? await updateUrl(row.id)
    : await gate.db
        .from("rpt_link")
        .insert({
          school_id: schoolId,
          owner_id: gate.user.id,
          session,
          title: parsed.data.title,
          url: parsed.data.url,
        })
        .select("id")
        .single();

  if (write.error) {
    // Lost the race: a second save slipped between the lookup and the
    // insert, and the unique index caught it. Re-read and take the update
    // path instead of reporting a failure for a plan that exists.
    if ((write.error as { code?: string }).code === "23505") {
      const retry = await findByTitle(parsed.data.title);
      if (!retry.error && retry.id) {
        const fixed = await updateUrl(retry.id);
        if (!fixed.error) {
          return NextResponse.json({
            ok: true,
            id: (fixed.data as { id: string }).id,
          });
        }
      }
    }
    console.error("[rpt] attach failed:", write.error.message);
    return NextResponse.json({ error: "Ralat pelayan semasa menyimpan RPT." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: (write.data as { id: string }).id });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePermission(request, "rph");
  if ("error" in gate) return gate.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id || !UUID.test(id)) {
    return NextResponse.json({ error: "ID tidak sah" }, { status: 400 });
  }

  // Ownership checked explicitly: this handler holds the secret key and
  // bypasses RLS, so a bare `.eq("id", id)` delete would remove a colleague's
  // link. 404 for "not yours" and "gone" alike - naming a stranger's row
  // reveals more than refusing to does.
  const { error } = await gate.db
    .from("rpt_link")
    .delete()
    .eq("id", id)
    .eq("owner_id", gate.user.id);

  if (error) {
    console.error("[rpt] delete failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan semasa memadam RPT." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

const renameSchema = z
  .object({
    id: z.string().regex(UUID, "ID tidak sah"),
    title: z.string().trim().min(1, "Tajuk diperlukan").max(120).optional(),
    url: z
      .string()
      .trim()
      .max(2000)
      .refine(
        (value) => {
          let host: string;
          try {
            const parsed = new URL(value);
            if (parsed.protocol !== "https:") return false;
            host = parsed.hostname.toLowerCase();
          } catch {
            return false;
          }
          return DRIVE_HOSTS.has(host);
        },
        { message: "Pautan Google Drive sahaja (drive.google.com)." },
      )
      .optional(),
  })
  .refine((d) => d.title !== undefined || d.url !== undefined, {
    message: "Tiada perubahan dihantar",
  });

/**
 * PATCH /api/rpt - rename a link, replace its URL, or both.
 *
 * The title *is* the row's identity, so renaming needs the clash check a
 * fresh attach gets: another row already holding the name (case-insensitively,
 * like the unique index compares) is a 409 naming nothing, not a silent
 * merge. A clash found only as a unique violation on the write - the twin
 * the lookup could not see - is reported the same way.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
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
  const parsed = renameSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }
  const d = parsed.data;

  const { data: row, error: readErr } = await gate.db
    .from("rpt_link")
    .select("id, session, title")
    .eq("id", d.id)
    .eq("school_id", schoolId)
    .eq("owner_id", gate.user.id)
    .maybeSingle();
  if (readErr) {
    console.error("[rpt] rename lookup failed:", readErr.message);
    return NextResponse.json({ error: "Ralat pelayan semasa menyimpan RPT." }, { status: 500 });
  }
  const current = row as { id: string; session: string; title: string } | null;
  if (!current) {
    return NextResponse.json({ error: "Pautan RPT tidak dijumpai" }, { status: 404 });
  }

  // A new name that only differs by case from the row's own is still the same
  // row - the lookup below would find it and cry clash against itself.
  if (d.title !== undefined && d.title.toLowerCase() !== current.title.toLowerCase()) {
    const { data: clash, error: clashErr } = await gate.db
      .from("rpt_link")
      .select("id")
      .eq("school_id", schoolId)
      .eq("owner_id", gate.user.id)
      .eq("session", current.session)
      .ilike("title", escapeLike(d.title))
      .limit(1)
      .maybeSingle();
    if (clashErr) {
      console.error("[rpt] clash lookup failed:", clashErr.message);
      return NextResponse.json(
        { error: "Ralat pelayan semasa menyimpan RPT." },
        { status: 500 },
      );
    }
    if (clash) {
      return NextResponse.json(
        { error: "Tajuk sudah digunakan oleh pautan lain." },
        { status: 409 },
      );
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.url !== undefined) patch.url = d.url;

  const { error } = await gate.db
    .from("rpt_link")
    .update(patch)
    .eq("id", d.id)
    .eq("owner_id", gate.user.id)
    .select("id")
    .single();

  if (error) {
    // The twin the clash lookup could not see (see POST): a clash by any
    // other name is still a clash.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "Tajuk sudah digunakan oleh pautan lain." },
        { status: 409 },
      );
    }
    console.error("[rpt] rename failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan semasa menyimpan RPT." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: d.id });
}
