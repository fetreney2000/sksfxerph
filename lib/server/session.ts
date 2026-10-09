import { SESSION } from "@/lib/config";
import { adminDb } from "@/lib/server/db";

/**
 * The school year in effect, read per request.
 *
 * `school_setting.current_session` is the authority — the administrator edits it
 * from `/pentadbiran` — and `SESSION` in `lib/config.ts` is only the fallback for
 * local mode, where there is no row to read, and for any deployment whose secret
 * key is not configured.
 *
 * Kept in one place because four paths must agree: the app layout ships this to
 * the browser so `createPlan` stamps it on new documents, `/api/queue` and
 * `/api/stats` filter on it, and the editor keys its Dexie queries on it. A split
 * here is silent — plans land under one year while the dashboards count another,
 * and `sync_rph` rejects them as belonging to the wrong session.
 *
 * Takes the *user*, not a school id: membership is resolved here too so the
 * layout does not have to build a second privileged client to find out which
 * school it is asking about.
 */
export async function resolveSession(userId: string | null): Promise<string> {
  if (!userId) return SESSION;

  try {
    const db = adminDb(userId);

    const { data: membership, error: memberError } = await db
      .from("school_member")
      .select("school_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (memberError || !membership) {
      if (memberError)
        console.error("[session] membership lookup failed:", memberError.message);
      return SESSION;
    }

    const { data: setting, error } = await db
      .from("school_setting")
      .select("current_session")
      .eq("school_id", membership.school_id)
      .maybeSingle();

    if (error) {
      console.error("[session] lookup failed:", error.message);
      return SESSION;
    }
    return (setting as { current_session: string } | null)?.current_session ?? SESSION;
  } catch {
    // adminDb throws when the secret key is missing — fall back rather than
    // turning a configuration gap into a blank app shell.
    return SESSION;
  }
}
