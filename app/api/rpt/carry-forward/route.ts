import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { escapeLike } from "@/app/api/rpt/route";
import { requirePermission, schoolIdFor } from "@/lib/server/auth/guard";
import { resolveSession } from "@/lib/server/session";

/**
 * GET / POST /api/rpt/carry-forward - bring last session's links forward.
 *
 * RPT Drive files are usually reused year to year, but links are keyed per
 * session - so a new school year starts empty with no history view and no way
 * to copy. This is that way: the newest session holding any of the caller's
 * rows, and a one-press copy of the titles the current session does not yet
 * have. Teachers only: a Guru Besar holds no links to carry, and reviewers
 * read through `/api/pantau/teachers`.
 */

const carrySchema = z.object({
  // A stored session value, not a shape the server dictates: the database
  // holds whatever `school_setting` once said, so this only refuses an empty
  // value and the current session itself.
  fromSession: z.string().trim().min(1, "Sesi diperlukan").max(20),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePermission(request, "rph");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ fromSession: null as string | null, count: 0 });
  }
  const session = await resolveSession(gate.user.id);

  const { data, error } = await gate.db
    .from("rpt_link")
    .select("session")
    .eq("school_id", schoolId)
    .eq("owner_id", gate.user.id)
    .order("session", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("[rpt] carry lookup failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  const sessions = (data ?? []) as { session: string }[];
  const from = sessions.map((r) => r.session).find((s) => s !== session) ?? null;
  const count = from === null ? 0 : sessions.filter((r) => r.session === from).length;
  return NextResponse.json({ fromSession: from, count });
}

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
  const parsed = carrySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }
  const fromSession = parsed.data.fromSession;
  if (fromSession === session) {
    return NextResponse.json({ error: "Sesi semasa tidak perlu disalin." }, { status: 422 });
  }

  const { data: source, error: readErr } = await gate.db
    .from("rpt_link")
    .select("title, url")
    .eq("school_id", schoolId)
    .eq("owner_id", gate.user.id)
    .eq("session", fromSession)
    .order("title", { ascending: true });

  if (readErr) {
    console.error("[rpt] carry read failed:", readErr.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  let copied = 0;
  let skipped = 0;
  for (const s of (source ?? []) as { title: string; url: string }[]) {
    // Titles the current session already holds - under any capitalisation -
    // are left alone: the teacher's newer link wins over the carried one.
    const { data: hit, error: lookupErr } = await gate.db
      .from("rpt_link")
      .select("id")
      .eq("school_id", schoolId)
      .eq("owner_id", gate.user.id)
      .eq("session", session)
      .ilike("title", escapeLike(s.title))
      .limit(1)
      .maybeSingle();
    if (lookupErr) {
      console.error("[rpt] carry lookup failed:", lookupErr.message);
      return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
    }
    if (hit) {
      skipped += 1;
      continue;
    }
    const { error: insertErr } = await gate.db.from("rpt_link").insert({
      school_id: schoolId,
      owner_id: gate.user.id,
      session,
      title: s.title,
      url: s.url,
    });
    // A twin filed since the lookup (see POST /api/rpt): the title exists,
    // so there is nothing to copy - count it skipped rather than failing
    // the whole batch on one row.
    if (insertErr) {
      if ((insertErr as { code?: string }).code === "23505") {
        skipped += 1;
        continue;
      }
      console.error("[rpt] carry insert failed:", insertErr.message);
      return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
    }
    copied += 1;
  }

  return NextResponse.json({ ok: true, fromSession, copied, skipped });
}
