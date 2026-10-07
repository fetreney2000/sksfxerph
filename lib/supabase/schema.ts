/**
 * The PostgREST schema this app talks to.
 *
 * Supabase exposes schemas individually (Dashboard → Settings → API →
 * "Exposed schemas"), and PostgREST only searches the **default** one unless a
 * profile header says otherwise. Without `db: { schema: DB_SCHEMA }` on every
 * client, `.from("school")` resolves against `public` and 404s even though the
 * tables exist and RLS would allow the read.
 *
 * Keep in sync with `db/schema.sql` (`create schema if not exists erph`).
 */
export const DB_SCHEMA = "erph";
