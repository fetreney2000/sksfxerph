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

/**
 * What a *synced* deployment shows when it cannot read its own school row.
 *
 * Deliberately blank rather than the bundled school. A statutory document
 * headed with another school's name, printed on this school's own paper, is
 * worse than an unbranded one — and a blank one is what makes a missing row
 * (or a missing `SUPABASE_SECRET_KEY`, which `adminDb` throws on) findable,
 * instead of quietly rebranding the school to somewhere in Keningau. The
 * session year is left alone: an empty one would stamp every new plan with a
 * year that matches nothing and queue it forever.
 */
const UNKNOWN: SchoolContext = {
  session: SESSION,
  school: { name: "", place: "", motto: "", logo: SCHOOL.logo },
};

export async function resolveSchool(): Promise<SchoolContext> {
  // Local mode has no row to read, so the bundled school *is* the school.
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
      console.error(
        "[school] lookup failed:",
        error?.message ?? "no active school row — add one in Papan Pemuka",
      );
      return UNKNOWN;
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
        // A field the administrator has left blank stays blank. Substituting
        // the bundled school's name for a row that *exists* is the same lie as
        // substituting it for one that does not, and the printed form has an
        // em dash for an empty cell already. The crest is different: it is a
        // file in this deployment's own `public/`, so whatever it depicts is
        // the deployment's to show.
        name: row.nama?.trim() || "",
        place: placeFrom(row.ppd, row.jpn) || "",
        motto: row.motto?.trim() || "",
        logo: row.logo_url || SCHOOL.logo,
      },
    };
  } catch (err) {
    // `adminDb` throws when the secret key is missing. Logged rather than
    // swallowed: a configuration gap that quietly renders the wrong school is
    // one that nobody ever fixes.
    console.error("[school] resolve failed:", err);
    return UNKNOWN;
  }
}
