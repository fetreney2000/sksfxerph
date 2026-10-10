import { strFromU8, unzipSync } from "fflate";
import { normalisePayload, type RphPayload } from "@/lib/schemas/rph";

/**
 * Read an existing .docx RPH into the fields the penyunting knows.
 *
 * ## What this is, and what it is not
 *
 * A .docx is a zip holding OOXML. The layout the school uses — a table of
 * label-then-value cells — is exactly the structure that survives in
 * `word/document.xml`, so the labels can be matched and the values taken
 * without a rendering engine. `mammoth` would have been the usual choice, but
 * it pulls in `sprintf-js`, which carries an advisory with no non-breaking
 * fix; reading the XML directly costs about eighty lines and nothing else.
 *
 * It is a heuristic, and it is meant to be one. Word documents in the wild
 * merge cells, split labels across runs, and label the same field three
 * different ways across ten years of templates. So this never saves anything:
 * it returns a payload for the teacher to correct in the penyunting. Getting
 * half of it right still saves them the half they would have retyped, and
 * getting all of it wrong costs them nothing but a glance.
 *
 * A file that cannot be read at all throws — "this is not a .docx" is a fact
 * about the file, not about the teacher, and they need to be told which.
 */
export interface ImportedRph {
  payload: RphPayload;
  /** Masa Mula / Masa Tamat, when the document states them. */
  slotTime?: string;
  slotTimeEnd?: string;
}

export async function parseDocx(file: File): Promise<ImportedRph> {
  const bytes = await readBytes(file);

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Fail ini bukan dokumen .docx yang sah.");
  }

  const xml = files["word/document.xml"];
  if (!xml) throw new Error("Dokumen ini tiada kandungan.");

  return parseDocumentXml(strFromU8(xml));
}

/**
 * File bytes, without assuming `Blob.arrayBuffer`.
 *
 * jsdom has no `arrayBuffer` on Blob, and neither did any browser before 2019.
 * The file input is the one part of this feature that has to work wherever a
 * teacher can open the app, so the older path is kept rather than left to fail
 * with a TypeError that says nothing about what went wrong.
 */
function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error("Fail ini tidak dapat dibaca."));
    reader.readAsArrayBuffer(file);
  });
}

/* ── OOXML reading ──────────────────────────────────────────────────────── */

/**
 * Every element with this local name, ignoring the prefix.
 *
 * Word uses `w:` but other producers use `ns1:` or none at all, and
 * `getElementsByTagName("w:t")` would silently find nothing on a document
 * that is perfectly valid.
 */
function allByLocal(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((e) => e.localName === name);
}

function childrenByLocal(root: Element, name: string): Element[] {
  return Array.from(root.children).filter((e) => e.localName === name);
}

/**
 * A paragraph's text.
 *
 * Runs are joined with nothing: Word splits a word across `<w:t>` elements
 * mid-syllable when so much as a spell-check underline lands on it, so a
 * separator would turn "Pengajaran" into "Pengaj rajaran". Tabs and explicit
 * line breaks *are* separators, because the author put them there.
 */
function textOf(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType !== 1) return;
    const e = node as Element;
    if (e.localName === "t") parts.push(e.textContent ?? "");
    else if (e.localName === "tab" || e.localName === "br") parts.push(" ");
    else for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(el);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/**
 * Each paragraph in a cell, separately.
 *
 * The Aktiviti PdPC cell holds a list, one entry per paragraph. Reading the
 * cell as a single string would collapse that list into one line — which is
 * the difference between five activities and one very long one.
 */
function linesOf(el: Element): string[] {
  return childrenByLocal(el, "p")
    .map((p) => textOf(p))
    .filter((t) => t !== "");
}

/* ── Field matching ─────────────────────────────────────────────────────── */

/** "Tema/Bidang/ Tajuk" → "tema bidang tajuk", so labels compare cleanly. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "7:20 am", "07.20", "1240" — the ways a school writes a lesson time. */
function asTime(raw: string): string | undefined {
  const m = raw.replace(/\./g, ":").match(/(\d{1,2})\s*[:h]?\s*(\d{2})?\s*(am|pm|pg|mt)?/i);
  if (!m) return undefined;
  const hour = Number.parseInt(m[1] ?? "", 10);
  if (Number.isNaN(hour) || hour > 24) return undefined;
  const minute = m[2] ?? "00";
  const pm = /^(pm|mt)$/i.test(m[3] ?? "");
  const h24 = pm && hour < 12 ? hour + 12 : hour === 12 && !pm ? 0 : hour;
  if (h24 > 23 || Number.parseInt(minute, 10) > 59) return undefined;
  return `${String(h24).padStart(2, "0")}:${minute}`;
}

/** A list entry indented behind a hyphen on the printed form. */
function asActivity(line: string): { nama: string; sub: boolean } | null {
  const sub = /^[-–—•*]\s*/.test(line);
  const nama = line.replace(/^[-–—•*]\s*/, "").trim();
  return nama ? { nama, sub } : null;
}

/* ── The document ───────────────────────────────────────────────────────── */

export function parseDocumentXml(xml: string): ImportedRph {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const body = allByLocal(doc, "body")[0];
  if (!body) throw new Error("Dokumen ini tiada kandungan.");

  // label → the cell holding its value, as a list of lines.
  const fields = new Map<string, string[]>();
  const loose: string[] = [];

  for (const child of Array.from(body.children)) {
    if (child.localName === "p") {
      const text = textOf(child);
      if (text) loose.push(text);
      continue;
    }
    if (child.localName !== "tbl") continue;

    for (const row of childrenByLocal(child, "tr")) {
      const cells = childrenByLocal(row, "tc");
      const first = cells[0];
      if (!first || cells.length < 2) continue;
      const label = norm(textOf(first));
      if (!label) continue;
      // The value is every cell after the label. Some forms split a value
      // across two cells rather than wrapping it; joining keeps both halves.
      const value = cells
        .slice(1)
        .flatMap((c) => linesOf(c))
        .filter((t) => t !== "");
      if (value.length && !fields.has(label)) fields.set(label, value);
    }
  }

  const find = (...needles: string[]): string[] | undefined => {
    for (const [label, value] of fields) {
      if (needles.some((n) => label === n || label.startsWith(n))) return value;
    }
    return undefined;
  };
  const one = (v: string[] | undefined) => v?.join(" ") ?? "";

  const aktiviti = (find("aktiviti pdpc", "aktiviti pdp", "aktiviti") ?? [])
    .map((line) => asActivity(line))
    .filter((a): a is { nama: string; sub: boolean } => a !== null);

  const imported: ImportedRph = {
    payload: normalisePayload({
      // "Tema/Bidang/Tajuk" is one cell on the form and three fields here, so
      // a document that only fills the combined cell still lands somewhere the
      // teacher can split it.
      fasa_tema: one(find("tema")),
      bidang: one(find("bidang")),
      tajuk: one(find("tajuk")),
      standard_kandungan: one(find("standard kandungan")),
      standard_pembelajaran: one(find("standard pembelajaran")),
      objektif: one(find("objektif")),
      kriteria_kejayaan: one(find("kriteria kejayaan", "kriteria")),
      aktiviti,
      refleksi: one(find("refleksi")),
    }),
  };

  const mula = asTime(one(find("masa mula", "masa mula masa", "mula")));
  const tamat = asTime(one(find("masa tamat", "tamat")));
  if (mula) imported.slotTime = mula;
  if (tamat) imported.slotTimeEnd = tamat;

  // A document with no table at all — some schools type the form freehand.
  // "Label: value" per paragraph is a weak signal, but a teacher who uploaded
  // the wrong file should see the fields empty rather than an error that says
  // nothing about why.
  if (fields.size === 0) {
    for (const line of loose) {
      const m = line.match(/^([^:]{3,40}):\s*(.+)$/);
      if (!m) continue;
      const label = norm(m[1] ?? "");
      const value = m[2] ?? "";
      if (label.startsWith("standard kandungan")) imported.payload.standard_kandungan = value;
      else if (label.startsWith("standard pembelajaran"))
        imported.payload.standard_pembelajaran = value;
      else if (label.startsWith("objektif")) imported.payload.objektif = value;
      else if (label.startsWith("kriteria")) imported.payload.kriteria_kejayaan = value;
      else if (label.startsWith("refleksi")) imported.payload.refleksi = value;
    }
  }

  return imported;
}
