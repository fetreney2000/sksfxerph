import { NextResponse } from "next/server";

/**
 * PostgREST failure → client response, without the internals.
 *
 * `error.message` straight from the database names constraints, tables and
 * SQLSTATEs ("duplicate key value violates unique constraint
 * \"rpt_link_owner_title_uniq\"") - a schema map handed to whoever triggers
 * it. So nothing raw ever leaves a handler: the full text is logged
 * server-side, and the client gets one of two things.
 *
 *   · `P0001` - a plpgsql `raise exception`, which in db/schema.sql is always
 *     an authored, static Malay sentence ("RPH tidak dijumpai"). Passing it
 *     through keeps the UX the schema was written for: the server telling the
 *     teacher *why*, in their language.
 *   · everything else - constraint violations, RLS denials, PostgREST codes,
 *     connection failures - a generic line that names nothing.
 *
 * The two interpolating raises (`Kelas "%s" sudah wujud`, `Minggu % ...`)
 * echo the caller's own input back, which is why the pass-through stays safe:
 * there is no row here the caller did not send.
 */
export function toClientError(
  prefix: string,
  error: unknown,
  status = 422,
  fallback = "Ralat pelayan.",
): NextResponse {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "unknown";
  console.error(prefix, message);

  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  const safe = code === "P0001" && message ? message : fallback;
  return NextResponse.json({ error: safe }, { status });
}

/** UUID shape check - the same test every `?id=` and `:id` route applies. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Name the infrastructure failure without describing it.
 *
 * `toClientError` hides everything behind one line, which is correct for
 * secrets but useless for triage: "Ralat pelayan." cannot tell a stale
 * database from a bad reference. Error *codes* carry no schema - no table,
 * column or constraint names - so they are safe to show, and each one points
 * at a different fix. Known codes get a sentence; any other code is appended
 * verbatim so the next report identifies itself. Null only when there is no
 * code at all, and the caller falls back to the generic line.
 */
export function dbFailureMessage(error: unknown): string | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (!code) return null;
  switch (code) {
    case "PGRST202":
    case "PGRST204":
      return "Aplikasi dan pangkalan data tidak sepadan (kod PGRST). Hubungi pentadbir untuk selaraskan migrasi.";
    case "42501":
      return "Akaun ini tiada kebenaran menulis (kod 42501).";
    case "23503":
      return "Rujukan kelas atau subjek tidak sah (kod 23503).";
    case "23514":
      return "Nilai di luar julat yang dibenarkan (kod 23514).";
    case "23502":
      return "Maklumat tidak lengkap (kod 23502).";
    default:
      return code.startsWith("PGRST")
        ? `Pangkalan data menolak permintaan (kod ${code}).`
        : `Ralat pelayan. (kod: ${code})`;
  }
}
