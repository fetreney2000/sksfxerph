import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { can, type Permission } from "@/lib/auth/permissions";
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

/**
 * Any role holding `permission`.
 *
 * Generic rather than another named guard, because the next route that needs a
 * permission check should not have to invent its own. The distinction this
 * exists for is `/sekolah`: the aggregate counts behind it are open to every
 * member (they cannot name anyone), while the per-teacher rows behind *this*
 * are not — and a GPK's rows are narrower still, which `erph.pantau_teachers`
 * enforces independently of whatever this check allows.
 */
export async function requirePermission(
  req: NextRequest,
  permission: Permission,
): Promise<{ user: SessionUser; db: ReturnType<typeof adminDb> } | { error: NextResponse }> {
  const gate = await requireDbUser(req);
  if ("error" in gate) return gate;
  if (!can(gate.user.role, permission)) {
    return {
      error: NextResponse.json({ error: "Peranan tidak mencukupi" }, { status: 403 }),
    };
  }
  return gate;
}

/** Graders only — the queue and review routes. Roles come from `permissions`. */
export async function requireReviewer(
  req: NextRequest,
): Promise<{ user: SessionUser; db: ReturnType<typeof adminDb> } | { error: NextResponse }> {
  const gate = await requireDbUser(req);
  if ("error" in gate) return gate;
  if (!can(gate.user.role, "semak")) {
    return {
      error: NextResponse.json({ error: "Peranan penyemak diperlukan" }, { status: 403 }),
    };
  }
  return gate;
}

/** App set-up only — reserved for the `/pentadbiran` API. */
export async function requireAdministrator(
  req: NextRequest,
): Promise<{ user: SessionUser; db: ReturnType<typeof adminDb> } | { error: NextResponse }> {
  const gate = await requireDbUser(req);
  if ("error" in gate) return gate;
  if (!can(gate.user.role, "pentadbir")) {
    return {
      error: NextResponse.json({ error: "Peranan pentadbir diperlukan" }, { status: 403 }),
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
