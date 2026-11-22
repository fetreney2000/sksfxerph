import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { formatMyt } from "@/lib/date";
import type { RphPayload } from "@/lib/schemas/rph";
import { fingerprint } from "@/lib/signature";

/** An ISO instant in the school's own time, or the raw string if invalid. */
function signedLabel(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return formatMyt({
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** The fields the printable PDF actually reads from a plan. */
export interface PdfPlan {
  payload: RphPayload;
  session: string;
  planDate: string;
  slotTime: string;
  slotTimeEnd: string;
  classNames: string[];
  subjectName: string;
}

/**
 * Text-based, selectable PDF; long sections flow onto additional pages.
 *
 * Shared by the browser fallback (local mode) and the server archive export,
 * so a PDF produced on either side has the same content.
 */
export async function buildRphPdf(input: {
  plan: PdfPlan;
  seal: SignaturePayload | null;
  teacherName: string;
  schoolName: string;
  fontBytes: Uint8Array;
  /** Called once per character the bundled font cannot draw. */
  onWarning?: (message: string) => void;
}): Promise<Uint8Array> {
  const { plan, seal, teacherName, schoolName, fontBytes, onWarning } = input;
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  let page = pdf.addPage([595.28, 841.89]);
  let y = 796;
  const x = 45;
  const width = 505;
  const fontSize = 10;

  function line(text: string, size = fontSize, color = rgb(0.12, 0.16, 0.2)) {
    if (y < 48) {
      page = pdf.addPage([595.28, 841.89]);
      y = 796;
    }
    page.drawText(text, { x, y, size, font, color });
    y -= size + 5;
  }
  function text(value: string, size = fontSize) {
    const source = value.replace(/\r/g, "").replace(/\t/g, "    ");
    let cleaned = "";
    for (const character of source) {
      if (character !== "\n" && !supported.has(character.codePointAt(0) ?? 0)) {
        // A missing glyph must not lose the whole archive. Draw a visible
        // replacement and report it, rather than silently dropping the text.
        cleaned += "?";
        onWarning?.(
          `Aksara “${character}” tidak disokong oleh fon PDF dan diganti dengan “?”.`,
        );
      } else {
        cleaned += character;
      }
    }
    for (const paragraph of cleaned.split("\n")) {
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) {
          current = next;
        } else {
          if (current) line(current, size);
          current = "";
          for (const char of word) {
            if (font.widthOfTextAtSize(current + char, size) > width) {
              line(current, size);
              current = char;
            } else current += char;
          }
        }
      }
      line(current || " ", size);
    }
  }
  function field(label: string, value: string) {
    y -= 3;
    text(label, 10);
    text(value.trim() || "-");
  }

  text("RANCANGAN PENGAJARAN HARIAN", 16);
  text(`${schoolName} - Sesi ${plan.session}`);
  field("Nama", teacherName);
  field("Subjek / Kelas", `${plan.subjectName} / ${plan.classNames.join(", ")}`);
  field("Tarikh / Masa", `${plan.planDate} / ${plan.slotTime} - ${plan.slotTimeEnd}`);
  field(
    "Tema / Bidang / Tajuk",
    [plan.payload.fasa_tema, plan.payload.bidang, plan.payload.tajuk]
      .filter(Boolean)
      .join(" / "),
  );
  field("Standard Kandungan", plan.payload.standard_kandungan);
  field("Standard Pembelajaran", plan.payload.standard_pembelajaran);
  field("Objektif", plan.payload.objektif);
  field("Kriteria Kejayaan", plan.payload.kriteria_kejayaan);
  field(
    "Aktiviti PdPC",
    plan.payload.aktiviti.map((a) => `${a.sub ? "  - " : ""}${a.nama}`).join("\n"),
  );
  field("Refleksi", plan.payload.refleksi);
  // The printed form carries both lines. The teacher signs even when the
  // reviewer has sealed the plan digitally.
  field("Tandatangan Guru", "____________________________");
  if (seal) {
    field(
      "Disahkan secara digital",
      [
        seal.signerName ?? "Penyemak",
        seal.signerTitle,
        seal.signedAt ? signedLabel(seal.signedAt) : undefined,
        `${seal.alg} - kunci ${fingerprint(seal.publicKey)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } else {
    field("Semakan Pentadbir", "____________________________");
  }
  return pdf.save();
}
