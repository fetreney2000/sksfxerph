import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { formatMyt, hariName, printedDayNumber } from "@/lib/date";
import type { RphPayload } from "@/lib/schemas/rph";
import { temaLengkap } from "@/lib/schemas/rph";
import { fingerprint } from "@/lib/signature";

/**
 * The school's RPH as a DOCX, shared by the single export and the archive ZIP.
 *
 * Keeping one builder means a plan does not look different depending on which
 * export button produced it.
 */
export interface DocxPlan {
  payload: RphPayload;
  session: string;
  planDate?: string;
  className?: string;
  subjectName?: string;
  slotTime?: string;
  slotTimeEnd?: string;
  teacherName: string;
  schoolName: string;
  signerName?: string;
  signerTitle?: string;
  /** ISO instant; printed in MYT. */
  signedAt?: string;
  signatureAlg?: string;
  signatureKey?: string;
}

const LABEL_FILL = "D9EAD3";

function cell(text: string, opts: { bold?: boolean; width?: number; label?: boolean } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.label
      ? { fill: LABEL_FILL, type: ShadingType.CLEAR, color: "auto" }
      : undefined,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: opts.bold ?? false, size: 20 })],
      }),
    ],
  });
}

function section(title: string, body: string, done: boolean) {
  return [
    new Paragraph({
      children: [
        new TextRun({ text: `${title}${done ? "" : "  (belum diisi)"}`, bold: true, size: 20 }),
      ],
      spacing: { before: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: body || "-", size: 20 })],
      spacing: { after: 120 },
    }),
  ];
}

function signedLabel(iso?: string): string | undefined {
  if (!iso) return iso;
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

export async function buildRphDocx(plan: DocxPlan): Promise<Buffer> {
  const {
    payload,
    session,
    planDate,
    className,
    subjectName,
    slotTime = "07:30",
    slotTimeEnd = "12:40",
    teacherName,
    schoolName,
    signerName,
    signerTitle,
    signedAt,
    signatureAlg,
    signatureKey,
  } = plan;
  const nonEmpty = (s: string) => s.trim() !== "";

  const doc = new Document({
    creator: "eRPH",
    title: `RPH ${className ?? ""} ${planDate ?? ""}`.trim(),
    sections: [
      {
        children: [
          new Paragraph({
            alignment: "center",
            children: [
              new TextRun({ text: "RANCANGAN PENGAJARAN HARIAN", bold: true, size: 26 }),
            ],
          }),
          new Paragraph({
            alignment: "center",
            children: [
              new TextRun({
                text: `${schoolName} · ${session} · Guru: ${teacherName}`,
                size: 18,
                color: "667085",
              }),
            ],
            spacing: { after: 240 },
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  cell("NAMA", { bold: true, width: 22, label: true }),
                  cell(teacherName || "-", { width: 78 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Subjek", { bold: true, width: 22, label: true }),
                  cell(subjectName || "-", { width: 28 }),
                  cell("Nama Kelas", { bold: true, width: 22, label: true }),
                  cell(className || "-", { width: 28 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Hari", { bold: true, width: 22, label: true }),
                  cell(
                    planDate ? `${printedDayNumber(planDate)}. ${hariName(planDate)}` : "-",
                    { width: 28 },
                  ),
                  cell("Tarikh", { bold: true, width: 22, label: true }),
                  cell(planDate || "-", { width: 28 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Masa Mula", { bold: true, width: 22, label: true }),
                  cell(slotTime || "-", { width: 28 }),
                  cell("Masa Tamat", { bold: true, width: 22, label: true }),
                  cell(slotTimeEnd || "-", { width: 28 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Tema / Bidang / Tajuk", { bold: true, width: 22, label: true }),
                  cell(temaLengkap(payload) || "-", { width: 78 }),
                ],
              }),
            ],
          }),

          ...section(
            "Standard Kandungan",
            payload.standard_kandungan,
            nonEmpty(payload.standard_kandungan),
          ),
          ...section(
            "Standard Pembelajaran",
            payload.standard_pembelajaran,
            nonEmpty(payload.standard_pembelajaran),
          ),
          ...section("Objektif", payload.objektif, nonEmpty(payload.objektif)),
          ...section(
            "Kriteria Kejayaan",
            payload.kriteria_kejayaan,
            nonEmpty(payload.kriteria_kejayaan),
          ),

          new Paragraph({
            children: [new TextRun({ text: "Aktiviti PdPC", bold: true, size: 20 })],
            spacing: { before: 200 },
          }),
          payload.aktiviti.length > 0
            ? new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: payload.aktiviti.map(
                  (a) =>
                    new TableRow({
                      children: [cell(a.sub ? `- ${a.nama}` : a.nama)],
                    }),
                ),
              })
            : new Paragraph({
                children: [new TextRun({ text: "- belum diisi -", size: 20 })],
              }),

          ...section("Refleksi", payload.refleksi, nonEmpty(payload.refleksi)),

          ...(signerName
            ? [
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  children: [
                    new TextRun({
                      text: "Disahkan secara digital",
                      bold: true,
                      size: 16,
                      color: "067647",
                    }),
                  ],
                  spacing: { before: 400 },
                }),
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  border: {
                    bottom: { style: BorderStyle.SINGLE, size: 6, color: "1D2939" },
                  },
                  children: [new TextRun({ text: " ", size: 16 })],
                  spacing: { after: 80 },
                }),
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  children: [new TextRun({ text: signerName, bold: true, size: 22 })],
                }),
                ...(signerTitle
                  ? [
                      new Paragraph({
                        alignment: AlignmentType.LEFT,
                        children: [new TextRun({ text: signerTitle, size: 18 })],
                      }),
                    ]
                  : []),
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  children: [
                    new TextRun({
                      text: signedLabel(signedAt) ?? "",
                      size: 16,
                      color: "667085",
                    }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  children: [
                    new TextRun({
                      text: [
                        signatureAlg ?? "",
                        signatureKey ? `kunci ${fingerprint(signatureKey)}` : "",
                      ]
                        .filter(Boolean)
                        .join("  ·  "),
                      size: 14,
                      color: "98A2B3",
                    }),
                  ],
                }),
              ]
            : [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "Tandatangan Guru: ____________________        Semakan Pentadbir: ____________________",
                      size: 20,
                    }),
                  ],
                  spacing: { before: 400 },
                }),
              ]),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
