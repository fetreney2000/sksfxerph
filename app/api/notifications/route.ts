import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth/guard";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link_view: string | null;
  read_at: string | null;
  created_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/notifications — the server half of the notification feed.
 *
 * `sahkan_rph()` and `hantar_balik()` insert rows for the plan's owner
 * (approved / returned). The Dexie mirror only ever holds events that happen
 * *on this device* (sync merges), so without this route a synced-mode teacher
 * would never see "RPH perlu dibaiki" in the bell — the table would have a
 * writer and no reader.
 *
 * Scoped to the caller by `user_id`; other people's notifications are not
 * visible even though the handler holds the secret key.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const { data, error } = await import("@/lib/server/db").then(({ adminDb }) =>
    adminDb(gate.user.id)
      .from("notification")
      // `read_at` and `link_view` were missing. Without read_at the client had
      // no way to tell a seen row from a new one — the bell's badge counted
      // every server notification forever, and "Tanda semua dibaca" touched
      // only the local mirror, leaving the badge exactly where it was.
      .select("id, type, title, body, link_view, read_at, created_at")
      .eq("user_id", gate.user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  );

  if (error) {
    console.error("[notifications] query failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil makluman." },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as unknown as NotificationRow[];
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      linkView: r.link_view,
      readAt: r.read_at ? new Date(r.read_at).getTime() : null,
      createdAt: new Date(r.created_at).getTime(),
    })),
  });
}

/**
 * PATCH /api/notifications — mark rows read.
 *
 * Exists because the only writer of `read_at` was the client's Dexie mirror,
 * which cannot reach this table. The bell therefore had no way to dismiss the
 * notifications the school actually generates: every review decision left a
 * permanent unread badge, and the button offered to clear it did nothing to
 * the rows that mattered.
 *
 * Scoped to the caller. `read_at` is only ever set, never cleared — a
 * notification that has been read has been read.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  let body: { all?: boolean; ids?: string[] };
  try {
    body = (await request.json()) as { all?: boolean; ids?: string[] };
  } catch {
    return NextResponse.json({ error: "Permintaan tidak sah" }, { status: 400 });
  }

  const { adminDb } = await import("@/lib/server/db");
  let query = adminDb(gate.user.id)
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    // The scope is the caller's own rows, and only those still unread — so a
    // repeated request is a no-op rather than a second write.
    .eq("user_id", gate.user.id)
    .is("read_at", null);

  if (!body.all) {
    const ids = (body.ids ?? []).filter((i) => UUID.test(i));
    // No ids and no `all` marks nothing. That is a no-op, not a mistake worth
    // a 400 — the caller asked for nothing and got nothing.
    if (ids.length === 0) return NextResponse.json({ ok: true });
    query = query.in("id", ids);
  }

  // No count requested: this supabase-js version types `.select` with one
  // argument, and the caller only needs to know it did not fail.
  const { error } = await query;

  if (error) {
    console.error("[notifications] mark-read failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa menandakan dibaca." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
