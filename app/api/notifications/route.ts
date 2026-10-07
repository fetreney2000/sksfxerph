import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth/guard";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  created_at: string;
}

/**
 * GET /api/notifications — the server half of the notification feed.
 *
 * `review_rph()` inserts rows into `erph.notification` (approved / returned),
 * and `pg_cron` writes deadline nudges. The Dexie mirror only ever holds events
 * that happen *on this device* (sync merges), so without this route a
 * synced-mode teacher would never see "RPH anda dikembalikan" in the bell —
 * the table would have a writer and no reader.
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
      .select("id, type, title, body, created_at")
      .eq("user_id", gate.user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  );

  if (error) {
    console.error("[notifications] query failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as NotificationRow[];
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      createdAt: new Date(r.created_at).getTime(),
    })),
  });
}
