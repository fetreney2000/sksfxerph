import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/config";
import { hariName, weekdayIndex } from "@/lib/date";
import { rphPayloadSchema, temaLengkap } from "@/lib/schemas/rph";
import { requireUser } from "@/lib/server/auth/guard";
import { resolveSchool } from "@/lib/server/school";
import { DB_SCHEMA } from "@/lib/supabase/schema";

/**
 * DOCX export in KPM RPH layout.
 *
 * Deliberately pure-JS (`docx`): headless Chrome does not fit the Vercel free
 * tier (erph-backend-research.md §2.1), and this route must stay inside the
 * 300 s Hobby budget with room to spare. The browser print path is the other
 * supported route — same JSON in, same layout out.
 *
 * POSTs the payload rather than reading by id because in local mode the
 * document only exists in the teacher's IndexedDB, not in Postgres. Works in
 * both modes; when a `document_id` is supplied *and* Supabase is configured,
 * the export is written to `erph.export_file` — RPH is a statutory record
 * (backend §10), so who produced a copy must be answerable.
 */
const bodySchema = z.object({
  document_id: z.string().uuid().optional(),
  payload: rphPayloadSchema,
  session: z.string(),
  teacherName: z.string().default("Nurul Aisyah binti Rahim"),
  schoolName: z.string().optional(),
  planDate: z.string().optional(),
  className: z.string().optional(),
  subjectName: z.string().optional(),
  /** Masa Mula / Masa Tamat — both are printed, so both are carried through. */
  slotTime: z.string().optional(),
  slotTimeEnd: z.string().optional(),
  /**
   * The seal, carried through to the printed document.
   *
   * Sent by a client that has already verified it in the browser, so the
   * export is a rendering of a checked signature rather than a claim. An
   * export with no signature simply prints the blank reviewer line it always
   * did — an unapproved plan must not look sealed.
   */
  signerName: z.string().optional(),
  signedAt: z.string().optional(),
  signatureAlg: z.string().optional(),
  signatureKey: z.string().optional(),
});

async function supabaseAdmin() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: DB_SCHEMA } },
  );
}

function cell(text: string, opts: { bold?: boolean; width?: number } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
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
      children: [new TextRun({ text: body || "—", size: 20 })],
      spacing: { after: 120 },
    }),
  ];
}

export async function POST(request: NextRequest) {
  // Authentication required in BOTH modes: local mode has real sessions now
  // (there is a login screen and a signed cookie), so there is no reason to
  // let an anonymous caller generate documents. Only the payload the caller
  // itself supplied is used, but an unauthenticated endpoint is an endpoint
  // someone will eventually point at something else.
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Pengesahan data gagal", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { payload, session, teacherName, planDate, className, subjectName } = parsed.data;
  const slotTime = parsed.data.slotTime ?? "07:30";
  const slotTimeEnd = parsed.data.slotTimeEnd ?? "12:40";
  // The school's name on a printed RPH comes from the row the administrator
  // edits, not from the build — otherwise the document and the screen it was
  // previewed on could name different schools. Resolved here rather than as a
  // zod default because a default has to be a constant.
  const schoolName = parsed.data.schoolName ?? (await resolveSchool()).school.name;

  // `document_id` is a claim by the caller, and it is stamped into the
  // statutory export log below. The *payload* is whatever was sent — that is
  // fine, it is this caller's own draft — but recording a colleague's plan as
  // the document this copy came from would falsify the audit trail, so the id
  // has to belong to the person asking.
  if (supabaseConfigured && parsed.data.document_id && "user" in gate) {
    const admin = await supabaseAdmin();
    const { data: owned, error } = await admin
      .from("rph_document")
      .select("owner_id")
      .eq("id", parsed.data.document_id)
      .maybeSingle();
    if (error || owned?.owner_id !== gate.user.id) {
      return NextResponse.json({ error: "Dokumen bukan milik anda" }, { status: 403 });
    }
  }

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

          // The header block the school's form uses: one two-column table,
          // label then value, in the order the paper prints them.
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  cell("NAMA", { bold: true, width: 22 }),
                  cell(teacherName, { width: 78 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Subjek", { bold: true, width: 22 }),
                  cell(subjectName || "—", { width: 28 }),
                  cell("Nama Kelas", { bold: true, width: 22 }),
                  cell(className || "—", { width: 28 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Hari", { bold: true, width: 22 }),
                  cell(planDate ? `${weekdayIndex(planDate)}. ${hariName(planDate)}` : "—", {
                    width: 28,
                  }),
                  cell("Tarikh", { bold: true, width: 22 }),
                  cell(planDate || "—", { width: 28 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Masa Mula", { bold: true, width: 22 }),
                  cell(slotTime || "—", { width: 28 }),
                  cell("Masa Tamat", { bold: true, width: 22 }),
                  cell(slotTimeEnd || "—", { width: 28 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Tema / Bidang / Tajuk", { bold: true, width: 22 }),
                  cell(temaLengkap(payload) || "—", { width: 78 }),
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

          // A list of names, as the paper form prints it — not a timed table.
          // The school's activities are ordered items, some indented beneath a
          // heading, and rendering them as a three-column grid would invent
          // columns the submitted document does not have.
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
                children: [new TextRun({ text: "— belum diisi —", size: 20 })],
              }),

          ...section("Refleksi", payload.refleksi, nonEmpty(payload.refleksi)),

          // The reviewer's line is a blank to sign when nothing has been sealed.
          // Once something has, the seal takes its place and carries the name,
          // the moment and the material needed to check it — because a document
          // that prints "Semakan Pentadbir: ____________" over an approval that
          // already happened is a document that understates what was done.
          ...(parsed.data.signerName
            ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `Disahkan secara digital oleh ${parsed.data.signerName}`,
                      bold: true,
                      size: 20,
                    }),
                  ],
                  spacing: { before: 400 },
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: [
                        parsed.data.signedAt ?? "",
                        parsed.data.signatureAlg ?? "",
                        parsed.data.signatureKey
                          ? `kunci ${parsed.data.signatureKey.slice(0, 16)}…`
                          : "",
                      ]
                        .filter(Boolean)
                        .join("  ·  "),
                      size: 16,
                      color: "667085",
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

  const buffer = await Packer.toBuffer(doc);
  const slug = `${(className ?? "rph").replace(/\s+/g, "-")}-${planDate ?? "draft"}`;
  const filename = `RPH-${slug}.docx`;

  // Backend §10: log the export. Fire-and-forget — a failed audit write must
  // never block the download, but failures are logged so the gap stays visible.
  if (supabaseConfigured && "user" in gate) {
    void (async () => {
      try {
        const admin = await supabaseAdmin();
        const { error } = await admin.from("export_file").insert({
          document_id: parsed.data.document_id ?? null,
          created_by: gate.user.id,
          bucket: "rph-exports",
          path: `${parsed.data.document_id ?? "adhoc"}/${filename}`,
          format: "docx",
          bytes: buffer.byteLength,
        });
        if (error) console.error("[export] audit write failed:", error.message);
      } catch (err) {
        console.error("[export] audit write failed:", err);
      }
    })();
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
