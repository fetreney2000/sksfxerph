import { redirect } from "next/navigation";

/**
 * The set-up console now lives on `/utama`, inside Papan Pemuka.
 *
 * The route stays as a redirect rather than disappearing: bookmarks and the
 * old sidebar link keep working, and the layout above still applies the
 * Administrator gate before this page runs. There is deliberately no second
 * screen here — two homes was the problem.
 */
export default function PentadbiranPage() {
  redirect("/utama");
}
