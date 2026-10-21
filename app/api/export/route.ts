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
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/config";
import { formatMyt, hariName, printedDayNumber } from "@/lib/date";
import { rateLimit } from "@/lib/http/rate-limit";
import { rphPayloadSchema, temaLengkap } from "@/lib/schemas/rph";
import { requireUser } from "@/lib/server/auth/guard";
import { resolveSchool } from "@/lib/server/school";
import { fingerprint } from "@/lib/signature";
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
  session: z.string().max(20),
  // No `teacherName`. The name printed on the paper is the person exporting
  // it, taken from the session below: that is the one source that cannot be a
  // stranger, and the route already refuses to export a document that is not
  // the caller's. It used to be accepted from the body *and* never sent, so
  // every exported DOCX printed a dash in the NAMA row and "Guru: undefined"
  // above it — a blank cell is honest, but this one was avoidable.
  //
  // Every free-text field is bounded. These are the teacher's own words, and
  // some of them end up in a header and a database column: an unbounded one is
  // a megabyte of text in a `content-disposition`, and a quote in it ends the
  // header parameter early.
  schoolName: z.string().max(120).optional(),
  planDate: z.string().max(20).optional(),
  className: z.string().max(80).optional(),
  subjectName: z.string().max(120).optional(),
  /** Masa Mula / Masa Tamat — both are printed, so both are carried through. */
  slotTime: z.string().max(10).optional(),
  slotTimeEnd: z.string().max(10).optional(),
  /**
   * The seal, carried through to the printed document.
   *
   * Sent by a client that has already verified it in the browser, so the
   * export is a rendering of a checked signature rather than a claim. An
   * export with no signature simply prints the blank reviewer line it always
   * did — an unapproved plan must not look sealed.
   */
  signerName: z.string().max(120).optional(),
  /**
   * The signer's office, printed under their name exactly as the weekly cover
   * sheet prints it. Optional for the same reason as the name: an export with
   * no seal prints the blank reviewer line, and an office without a name
   * would be a claim about nobody.
   */
  signerTitle: z.string().max(80).optional(),
  signedAt: z.string().max(40).optional(),
  signatureAlg: z.string().max(20).optional(),
  signatureKey: z.string().max(200).optional(),
});

/**
 * A filename that is safe in a `content-disposition` header.
 *
 * The class name is the teacher's own text and goes straight into the header,
 * so a quote in it would end the parameter early and the rest of the name
 * would be read as another header. Everything that is not a letter, a digit
 * or a plain separator becomes a dash.
 */
const safeName = (value: string, fallback: string): string => {
  const cleaned = value
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 60);
  return cleaned || fallback;
};

async function supabaseAdmin() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: DB_SCHEMA } },
  );
}

/**
 * The pale green of the school's label cells.
 *
 * Same hex as `LABEL_BG` in rph-paper, which is what the preview and the PDF
 * print from. Word stores shading as the bare colour, so the leading `#` is
 * dropped here rather than in two places.
 */
const LABEL_FILL = "D9EAD3";

/**
 * The private bucket the exported copies are kept in.
 *
 * The same name as the bucket db/schema.sql creates, so the path recorded in
 * `erph.export_file` names an object that exists in a bucket that exists —
 * rather than a place where a file might be.
 */
const EXPORT_BUCKET = "rph-exports";

function cell(text: string, opts: { bold?: boolean; width?: number; label?: boolean } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    // The label cells, not the values. Shading the whole table would leave the
    // reader with no way to tell a field's name from its content — which is
    // the one distinction the printed form's green carries.
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

  // Generating a DOCX is not free, and every call also writes a row to the
  // statutory export log. Keyed by the caller, so one teacher hammering the
  // button cannot lock the others out.
  const limited = rateLimit(`export:${gate.user.id}`);
  if (limited) return limited;

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

  const { payload, session, planDate, className, subjectName } = parsed.data;
  // The caller, not the request: a plan is the exporter's own (checked below),
  // so the name on it is theirs, whatever the body claims.
  const teacherName = gate.user.fullName;

  // The moment of the seal, written the way the school keeps time. An ISO
  // string ending in "Z" is a fact about a server; the person filing this
  // paper has a diary in MYT. Anything that is not a real instant is passed
  // through unchanged rather than rendered as "Invalid Date".
  const sealDate = parsed.data.signedAt ? new Date(parsed.data.signedAt) : null;
  const signedAt =
    sealDate && Number.isFinite(sealDate.getTime())
      ? formatMyt({
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(sealDate)
      : parsed.data.signedAt;
  const slotTime = parsed.data.slotTime ?? "07:30";
  const slotTimeEnd = parsed.data.slotTimeEnd ?? "12:40";
  // The school's name on a printed RPH comes from the row the administrator
  // edits, not from the build — otherwise the document and the screen it was
  // previewed on could name different schools. Resolved here rather than as a
  // zod default because a default has to be a constant.
  const school = await resolveSchool();
  const schoolName = parsed.data.schoolName ?? school.school.name;

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
                  cell("NAMA", { bold: true, width: 22, label: true }),
                  cell(teacherName || "-", { width: 78 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Subjek", { bold: true, width: 22, label: true }),
                  cell(subjectName || "—", { width: 28 }),
                  cell("Nama Kelas", { bold: true, width: 22, label: true }),
                  cell(className || "—", { width: 28 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Hari", { bold: true, width: 22, label: true }),
                  cell(
                    planDate ? `${printedDayNumber(planDate)}. ${hariName(planDate)}` : "—",
                    {
                      width: 28,
                    },
                  ),
                  cell("Tarikh", { bold: true, width: 22, label: true }),
                  cell(planDate || "—", { width: 28 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Masa Mula", { bold: true, width: 22, label: true }),
                  cell(slotTime || "—", { width: 28 }),
                  cell("Masa Tamat", { bold: true, width: 22, label: true }),
                  cell(slotTimeEnd || "—", { width: 28 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Tema / Bidang / Tajuk", { bold: true, width: 22, label: true }),
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
                // A signature block, laid out the way the paper form has one:
                // the seal, a rule to rest a pen on, the name under it, the
                // office under that, the moment — and the technical proof on
                // a quiet line of its own rather than shouting in the middle
                // of the document.
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
                  children: [
                    new TextRun({ text: parsed.data.signerName, bold: true, size: 22 }),
                  ],
                }),
                // The office beneath the name, as the cover sheet has it: a
                // signature with no office under it is a name anyone could
                // have typed, and the reader of the document has never met
                // them. Omitted when nobody has set one rather than guessed.
                ...(parsed.data.signerTitle
                  ? [
                      new Paragraph({
                        alignment: AlignmentType.LEFT,
                        children: [new TextRun({ text: parsed.data.signerTitle, size: 18 })],
                      }),
                    ]
                  : []),
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  children: [new TextRun({ text: signedAt ?? "", size: 16, color: "667085" })],
                }),
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  children: [
                    new TextRun({
                      text: [
                        parsed.data.signatureAlg ?? "",
                        parsed.data.signatureKey
                          ? `kunci ${fingerprint(parsed.data.signatureKey)}`
                          : "",
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

  const buffer = await Packer.toBuffer(doc);
  // The filename goes into a response header, so it is built from text that
  // cannot end the header parameter early.
  const slug = `${safeName(className ?? "", "rph")}-${safeName(planDate ?? "", "draft")}`;
  const filename = `RPH-${slug}.docx`;

  // Backend §10: log the export.
  //
  // Awaited, and the copy is stored. Both halves matter for a statutory
  // record: a fire-and-forget write can be lost when the function is frozen,
  // so a trail that is *sometimes* there is not a trail; and a row pointing at
  // a bucket path where no object was ever written says "document X was
  // exported" while keeping nothing about what was exported. The copy is put
  // in the school's private bucket, so `bucket` and `path` name something
  // that exists.
  if (supabaseConfigured && "user" in gate) {
    try {
      const admin = await supabaseAdmin();
      const path = `${parsed.data.document_id ?? "adhoc"}/${filename}`;
      const { error: upErr } = await admin.storage
        .from(EXPORT_BUCKET)
        .upload(path, new Uint8Array(buffer), {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: true,
        });
      if (upErr) {
        // The download below still works — the copy is streamed to the caller
        // either way — so a storage failure must not fail the export. It is
        // logged, because the row that follows will name a path with nothing
        // at it, and that gap should be visible.
        console.error("[export] could not store the copy:", upErr.message);
      }
      const { error } = await admin.from("export_file").insert({
        document_id: parsed.data.document_id ?? null,
        school_id: school.id || null,
        created_by: gate.user.id,
        bucket: EXPORT_BUCKET,
        path,
        format: "docx",
        bytes: buffer.byteLength,
      });
      if (error) console.error("[export] audit write failed:", error.message);
    } catch (err) {
      console.error("[export] audit write failed:", err);
    }
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
