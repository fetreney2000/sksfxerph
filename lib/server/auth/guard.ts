import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/config";
import { type SessionUser, userFromRequest } from "@/lib/server/auth/session";
import { adminDb } from "@/lib/server/db";

/**
 * Route-handler guard.
 *
 * With Supabase Auth gone, this — plus the signed cookie behind it — is the
 * only thing standing between an anonymous request and a privileged query.
 * Returns the authenticated user, or a ready-to-send 401/503.
 */
export async function requireUser(
  req: NextRequest,
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const user = await userFromRequest(req);
  if (!user) {
    return {
      error: NextResponse.json({ error: "Belum log masuk" }, { status: 401 }),
    };
  }
  return { user };
}

/** For routes that need a live database (i.e. everything but login). */
export async function requireDbUser(
  req: NextRequest,
): Promise<{ user: SessionUser; db: ReturnType<typeof adminDb> } | { error: NextResponse }> {
  const gate = await requireUser(req);
  if ("error" in gate) return gate;

  if (!supabaseConfigured) {
    // Local mode: no database. Routes that need data serve bundled fixtures
    // instead; routes that need writes report the mode honestly.
    return {
      error: NextResponse.json(
        { error: "Mod setempat: tiada pangkalan data ditetapkan" },
        { status: 503 },
      ),
    };
  }

  const admin = adminDb(gate.user.id);
  return { user: gate.user, db: admin };
}

/** Reviewers only (admin / coordinator) — used by the queue + review routes. */
export async function requireReviewer(
  req: NextRequest,
): Promise<{ user: SessionUser; db: ReturnType<typeof adminDb> } | { error: NextResponse }> {
  const gate = await requireDbUser(req);
  if ("error" in gate) return gate;
  if (gate.user.role !== "admin" && gate.user.role !== "coordinator") {
    return {
      error: NextResponse.json({ error: "Peranan penyemak diperlukan" }, { status: 403 }),
    };
  }
  return gate;
}

/**
 * The school a user belongs to. Resolved per request rather than baked into
 * the cookie so moving a teacher between schools (or removing them) takes
 * effect immediately instead of after the session expires.
 */
export async function schoolIdFor(
  db: ReturnType<typeof adminDb>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("school_member")
    .select("school_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[school] lookup failed:", error.message);
    return null;
  }
  return data?.school_id ?? null;
}
