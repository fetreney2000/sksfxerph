import { createClient } from "@supabase/supabase-js";
import { supabaseConfigured } from "@/lib/config";
import { DB_SCHEMA } from "@/lib/supabase/schema";

/**
 * The ONLY PostgREST client in the app — server-side, privileged, and used
 * exclusively by route handlers.
 *
 * Three consequences of moving authentication off Supabase Auth:
 *
 *  1. No browser holds a Supabase key that can act as a user, so every read and
 *     write goes through our handlers, which have already verified the session
 *     cookie. (`lib/supabase/client.ts` and `server.ts` — the GoTrue-based
 *     clients — are gone.)
 *
 *  2. This client authenticates with the SECRET key (`sb_secret_…`, falling
 *     back to the legacy `service_role` key), which PostgREST maps to the
 *     `service_role` database role — the one role that bypasses RLS. That makes
 *     it capable of reading any row, so **authorization must be explicit**: we
 *     pass the acting user's id and never rely on RLS to scope these queries.
 *
 *  3. `X-Erph-User` carries that user id so `erph.actor()` (db/schema.sql §3b)
 *     can resolve identity inside SECURITY DEFINER RPCs. PostgREST only honours
 *     this header when the caller has already proven it holds the secret key,
 *     so it cannot be spoofed from the publishable-key path.
 *
 * Throws if unconfigured — callers gate on `supabaseConfigured` first.
 */
export function adminDb(actorId?: string) {
  if (!supabaseConfigured) {
    throw new Error("adminDb() called in local mode — no Supabase configured.");
  }

  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "Set SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) for server-side access.",
    );
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    db: { schema: DB_SCHEMA },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: actorId ? { "X-Erph-User": actorId } : {},
    },
  });
}

/** True when a privileged client can be constructed (i.e. key is present). */
export function hasAdminCredentials(): boolean {
  return Boolean(
    supabaseConfigured &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}
