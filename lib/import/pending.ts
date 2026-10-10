import { normalisePayload, type RphPayload } from "@/lib/schemas/rph";

/**
 * A parsed .docx waiting to be opened in the penyunting.
 *
 * It goes through `sessionStorage` rather than a route parameter because a
 * lesson plan's fields are kilobytes of Malay prose and a URL is the wrong
 * place for them — and rather than straight into Dexie because the penyunting
 * creates nothing until the teacher saves. Importing a file should not leave a
 * draft behind if they navigate away without reading it.
 *
 * One-shot by design: read it once and it is gone. Keeping it would mean
 * every later visit to a blank penyunting silently re-imported a file the
 * teacher no longer had in mind.
 */
const KEY = "erph.pendingImport";

export function stashImport(imported: {
  payload: RphPayload;
  slotTime?: string;
  slotTimeEnd?: string;
}): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(imported));
  } catch {
    // A full or disabled sessionStorage must not swallow the import. The
    // teacher gets nothing pre-filled, which is what they had before, rather
    // than a button that appears to do nothing.
  }
}

export function takeImport(): {
  payload: RphPayload;
  slotTime?: string;
  slotTimeEnd?: string;
} | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      payload?: unknown;
      slotTime?: string;
      slotTimeEnd?: string;
    };
    // Re-normalised on the way out: whatever stashed it may have been an
    // older build, and the penyunting assumes the current shape.
    return {
      payload: normalisePayload(parsed.payload),
      ...(parsed.slotTime ? { slotTime: parsed.slotTime } : {}),
      ...(parsed.slotTimeEnd ? { slotTimeEnd: parsed.slotTimeEnd } : {}),
    };
  } catch {
    return null;
  }
}
