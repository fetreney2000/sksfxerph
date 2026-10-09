import { RphEditor } from "@/components/rph/editor";

/**
 * `/editor` with no id — a blank, unsaved plan.
 *
 * It used to resolve the most urgent draft and *create* one when the week was
 * empty, so merely opening the penyunting left a document behind: an empty
 * draft on the dashboard, a row nobody chose to write, and a queued sync. None
 * of that happens now. `RphEditor` holds an unsaved plan in memory and the
 * teacher's first press of Simpan is what makes it real.
 *
 * No loading shell of its own either — the editor already renders one while it
 * waits for the class list it needs before it can seed a document.
 */
export default function EditorIndexPage() {
  return <RphEditor />;
}
