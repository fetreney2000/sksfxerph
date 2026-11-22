"use client";

import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { supabaseConfigured } from "@/lib/config";
import { fingerprint, payloadHash, verifySignature } from "@/lib/signature";
import type { RphDocument } from "@/lib/types";

const safeName = (value: string) =>
  value
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 70) || "RPH";

async function signatureFor(doc: RphDocument): Promise<SignaturePayload | null> {
  if (!supabaseConfigured || doc.status !== "approved") return null;
  const response = await fetch(`/api/rph/${encodeURIComponent(doc.id)}/signature`);
  if (!response.ok) throw new Error("Tandatangan tidak dapat dimuatkan.");
  const { signature } = (await response.json()) as { signature: SignaturePayload | null };
  if (!signature) throw new Error("RPH disahkan tidak mempunyai tandatangan.");
  const envelope = signature.envelope as { hash?: unknown; doc?: unknown; decision?: unknown };
  if (
    envelope.doc !== doc.id ||
    envelope.decision !== "sahkan" ||
    envelope.hash !== (await payloadHash(doc.payload)) ||
    !(await verifySignature(signature.publicKey, signature.envelope, signature.signature))
  )
    throw new Error("Tandatangan tidak sah atau kandungan telah berubah.");
  return signature;
}

async function docxFor(
  doc: RphDocument,
  seal: SignaturePayload | null,
  onProgress: (message: string) => void,
): Promise<Uint8Array> {
  const body = JSON.stringify({
    ...(supabaseConfigured ? { document_id: doc.id } : {}),
    payload: doc.payload,
    session: doc.session,
    planDate: doc.planDate,
    className: doc.classNames.join(", "),
    subjectName: doc.subjectName,
    slotTime: doc.slotTime,
    slotTimeEnd: doc.slotTimeEnd,
    signerName: seal?.signerName ?? undefined,
    signerTitle: seal?.signerTitle ?? undefined,
    signedAt: seal?.signedAt ?? undefined,
    signatureAlg: seal?.alg ?? undefined,
    signatureKey: seal?.publicKey ?? undefined,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body,
    });
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (response.status !== 429 || attempt === 2) {
      throw new Error(`Eksport DOCX gagal (HTTP ${response.status}).`);
    }
    const retry = Number(response.headers.get("retry-after"));
    onProgress("Menunggu had eksport pelayan sebelum meneruskan…");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(65, Math.max(1, retry || 60)) * 1000),
    );
  }
  throw new Error("Eksport DOCX gagal.");
}

/** Text-based, selectable PDF; long sections flow onto additional pages. */
async function pdfFor(
  doc: RphDocument,
  seal: SignaturePayload | null,
  teacherName: string,
  schoolName: string,
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
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
    const cleaned = value.replace(/\r/g, "").replace(/\t/g, "    ");
    for (const character of cleaned) {
      if (character !== "\n" && !supported.has(character.codePointAt(0) ?? 0)) {
        throw new Error(`Aksara “${character}” tidak disokong oleh fon PDF.`);
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
  text(`${schoolName} - Sesi ${doc.session}`);
  field("Nama", teacherName);
  field("Subjek / Kelas", `${doc.subjectName} / ${doc.classNames.join(", ")}`);
  field("Tarikh / Masa", `${doc.planDate} / ${doc.slotTime} - ${doc.slotTimeEnd}`);
  field(
    "Tema / Bidang / Tajuk",
    [doc.payload.fasa_tema, doc.payload.bidang, doc.payload.tajuk].filter(Boolean).join(" / "),
  );
  field("Standard Kandungan", doc.payload.standard_kandungan);
  field("Standard Pembelajaran", doc.payload.standard_pembelajaran);
  field("Objektif", doc.payload.objektif);
  field("Kriteria Kejayaan", doc.payload.kriteria_kejayaan);
  field(
    "Aktiviti PdPC",
    doc.payload.aktiviti.map((a) => `${a.sub ? "  - " : ""}${a.nama}`).join("\n"),
  );
  field("Refleksi", doc.payload.refleksi);
  if (seal) {
    field(
      "Disahkan secara digital",
      [
        seal.signerName ?? "Penyemak",
        seal.signerTitle,
        seal.signedAt,
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

export async function downloadArchiveZip(
  plans: RphDocument[],
  name: string,
  teacherName: string,
  schoolName: string,
  format: "pdf" | "docx",
  onProgress: (message: string) => void,
): Promise<void> {
  if (!plans.length) throw new Error("Tiada RPH untuk dimuat turun.");
  let fontBytes: Uint8Array | null = null;
  if (format === "pdf") {
    const fontResponse = await fetch("/noto-sans-export.woff");
    if (!fontResponse.ok) throw new Error("Fon PDF tidak dapat dimuatkan.");
    fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
  }
  const files: Record<string, Uint8Array> = {};
  const ordered = [...plans].sort(
    (a, b) =>
      a.weekNo - b.weekNo || a.planDate.localeCompare(b.planDate) || a.id.localeCompare(b.id),
  );
  for (const [index, doc] of ordered.entries()) {
    onProgress(`Menyediakan RPH ${index + 1} daripada ${ordered.length}…`);
    try {
      const seal = await signatureFor(doc);
      let content: Uint8Array;
      if (format === "pdf") {
        if (!fontBytes) throw new Error("Fon PDF tidak dapat dimuatkan.");
        content = await pdfFor(doc, seal, teacherName, schoolName, fontBytes);
      } else {
        content = await docxFor(doc, seal, onProgress);
      }
      const path = `Minggu-${String(doc.weekNo).padStart(2, "0")}/${String(index + 1).padStart(3, "0")}-${safeName(doc.planDate)}-${safeName(doc.subjectName)}-${safeName(doc.classNames.join("-"))}`;
      files[`${path}.${format}`] = content;
    } catch (error) {
      throw new Error(
        `${doc.planDate} · ${doc.subjectName}: ${error instanceof Error ? error.message : "eksport gagal"}`,
      );
    }
  }
  onProgress("Menyediakan fail ZIP…");
  const { zip } = await import("fflate");
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 6 }, (err, result) => (err ? reject(err) : resolve(result))),
  );
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName(name)}-${format.toUpperCase()}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
