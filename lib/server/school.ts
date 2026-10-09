import { SCHOOL, SESSION, schoolCode, supabaseConfigured } from "@/lib/config";
import { placeFrom, type SchoolBrand } from "@/lib/school";
import { adminDb } from "@/lib/server/db";

/**
 * The school's identity and school year, read from the database.
 *
 * Public by design: this is called by the `(app)` layout *and* the login page,
 * and the login page is the screen where the crest matters most — it renders
 * before anyone has a session. It is keyed on `kod_sekolah` (the same natural
 * key `NEXT_PUBLIC_SCHOOL_CODE` and the seed use) rather than on a user's
 * membership, so it needs no caller identity and returns one school, which is
 * what this deployment is.
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

    const { data: school, error } = await db
      .from("school")
      .select("id, nama, ppd, jpn, motto, logo_url")
      .eq("kod_sekolah", schoolCode)
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
