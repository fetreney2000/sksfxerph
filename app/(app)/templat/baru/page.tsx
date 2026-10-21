import { RphEditor } from "@/components/rph/editor";

/**
 * `/templat/baru` — the RPH editor, pointed at the library.
 *
 * A template's whole value is the plan inside it, so the screen that writes
 * one is the screen that writes a plan. It used to be a dialog collecting a
 * title and three dropdowns, which could only ever produce an empty template
 * — a starting point with nothing to start from — and "Guna templat" then
 * opened a plan with no content in it.
 *
 * This route inherits the `templat` permission from the layout above it, so
 * the Administrator reaches it without owning a single plan.
 *
 * Nothing here is persisted by navigating: the editor holds the plan in
 * memory and the press of *Simpan sebagai templat* is what makes it a row in
 * `erph.rph_template`.
 */
export default function NewTemplatePage() {
  return <RphEditor mode="template" />;
}
