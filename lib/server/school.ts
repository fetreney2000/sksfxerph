import { SCHOOL, SESSION, supabaseConfigured } from "@/lib/config";
import { placeFrom, type SchoolBrand } from "@/lib/school";
import { adminDb } from "@/lib/server/db";

/**
 * The school's identity and school year, read from the database.
 *
 * Public by design: this is called by the `(app)` layout *and* the login page,
 * and the login page is the screen where the crest matters most — it renders
 * before anyone has a session. It takes no caller identity and returns one
 * school, which is what this deployment is.
 *
 * ## Deliberately *not* found by `kod_sekolah`
 *
 * It used to match the row against `NEXT_PUBLIC_SCHOOL_CODE`, which is inlined
 * into the build. That made the school's code a value the administrator could
 * not change: editing it would leave this lookup looking for a code no row had
 * any more, branding would fall back to `lib/config`, and the only cure would
 * be editing `.env` and redeploying — a half-working feature.
 *
 * Everything else in the app already resolves a school by **id**, never by
 * code: `schoolIdFor()` walks `school_member`, `sync_rph` derives it from
 * `class_id`, and `rph_document` has a `school_id` uuid with no code column.
 * The code is therefore a label, and this is the last place that ever treated
 * it as a key — so it is now read as the single active school instead.
 *
 * `lib/config.ts`'s `SCHOOL` and `SESSION` are the fallbacks, not dead code:
 * local mode has no row to read, and a database that has never been edited
 * should still render something sensible.
 */
export interface SchoolContext {
  session: string;
  school: SchoolBrand;
}

const FALLBACK: SchoolContext = { session: SESSION, school: SCHOOL };

export async function resolveSchool(): Promise<SchoolContext> {
  if (!supabaseConfigured) return FALLBACK;

  try {
    const db = adminDb();

    // `order by created_at` is not a tie-break for a deployment with two
    // schools — this app is single-school — but it keeps the choice stable
    // across navigations so branding cannot flicker between rows.
    const { data: school, error } = await db
      .from("school")
      .select("id, nama, ppd, jpn, motto, logo_url")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !school) {
      if (error) console.error("[school] lookup failed:", error.message);
      return FALLBACK;
    }

    const { data: setting } = await db
      .from("school_setting")
      .select("current_session")
      .eq("school_id", school.id)
      .maybeSingle();

    const row = school as {
      nama: string;
      ppd: string | null;
      jpn: string | null;
      motto: string | null;
      logo_url: string | null;
    };

    return {
      session: (setting as { current_session: string } | null)?.current_session ?? SESSION,
      school: {
        name: row.nama?.trim() || SCHOOL.name,
        place: placeFrom(row.ppd, row.jpn) || SCHOOL.place,
        motto: row.motto?.trim() || SCHOOL.motto,
        logo: row.logo_url || SCHOOL.logo,
      },
    };
  } catch {
    // adminDb throws when the secret key is missing — fall back rather than
    // turning a configuration gap into a blank app shell.
    return FALLBACK;
  }
}
