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
import { SCHOOL, supabaseConfigured } from "@/lib/config";
import { rphPayloadSchema } from "@/lib/schemas/rph";
import { requireUser } from "@/lib/server/auth/guard";
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
  schoolName: z.string().default(SCHOOL.name),
  planDate: z.string().optional(),
  className: z.string().optional(),
  subjectName: z.string().optional(),
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

  const { payload, session, teacherName, schoolName, planDate, className, subjectName } =
    parsed.data;

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

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  cell("Mata Pelajaran", { bold: true, width: 20 }),
                  cell(subjectName ?? "—", { width: 30 }),
                  cell("Kelas", { bold: true, width: 20 }),
                  cell(className ?? "—", { width: 30 }),
                ],
              }),
              new TableRow({
                children: [
                  cell("Tarikh", { bold: true }),
                  cell(planDate ?? "—"),
                  cell("Standard Kandungan", { bold: true }),
                  cell(payload.standard_kandungan || "—"),
                ],
              }),
              new TableRow({
                children: [
                  cell("Standard Pembelajaran", { bold: true }),
                  cell(payload.standard_pembelajaran || "—"),
                  cell("Bilangan Murid", { bold: true }),
                  cell(String(payload.bilangan_murid ?? "—")),
                ],
              }),
            ],
          }),

          ...section("Objektif Pembelajaran", payload.objektif, nonEmpty(payload.objektif)),

          new Paragraph({
            children: [
              new TextRun({ text: "Aktiviti Pengajaran & Pembelajaran", bold: true, size: 20 }),
            ],
            spacing: { before: 200 },
          }),
          payload.aktiviti.length > 0
            ? new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [
                  new TableRow({
                    children: [
                      cell("Masa", { bold: true, width: 12 }),
                      cell("Aktiviti Guru", { bold: true, width: 44 }),
                      cell("Aktiviti Murid", { bold: true, width: 44 }),
                    ],
                  }),
                  ...payload.aktiviti.map(
                    (a) =>
                      new TableRow({
                        children: [cell(a.masa), cell(a.aktiviti_guru), cell(a.aktiviti_murid)],
                      }),
                  ),
                ],
              })
            : new Paragraph({
                children: [new TextRun({ text: "— belum diisi —", size: 20 })],
              }),

          ...section(
            "EMK / Nilai",
            [payload.emk.join(" · "), payload.kbat ? `KBAT: ${payload.kbat}` : ""]
              .filter(Boolean)
              .join("\n"),
            payload.emk.length > 0 || nonEmpty(payload.kbat),
          ),

          ...section("Refleksi", payload.refleksi, nonEmpty(payload.refleksi)),
          ...section("Intervensi", payload.intervensi, nonEmpty(payload.intervensi)),

          new Paragraph({
            children: [
              new TextRun({
                text: "Tandatangan Guru: ____________________        Semakan Pentadbir: ____________________",
                size: 20,
              }),
            ],
            spacing: { before: 400 },
          }),
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
