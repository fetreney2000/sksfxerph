import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/config";
import { buildRphDocx } from "@/lib/export/docx";
import { buildRphPdf } from "@/lib/export/pdf";
import { rateLimit } from "@/lib/http/rate-limit";
import { requireDbUser } from "@/lib/server/auth/guard";
import { loadExportDocument } from "@/lib/server/export-document";
import { resolveSchool } from "@/lib/server/school";

/**
 * POST /api/export/archive - a PDF ZIP generated and recorded on the server.
 *
 * The browser used to build these PDFs, which left a statutory export with no
 * `export_file` row. Here every document is loaded from the database, its
 * approval signature is verified server-side, the PDFs are generated from that
 * stored content, and the finished ZIP is kept in the private bucket before it
 * is streamed back. The ZIP also carries a manifest naming every plan inside it.
 */
const bodySchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1, "Tiada RPH dipilih").max(200),
  name: z.string().max(120).optional(),
  format: z.enum(["pdf", "docx"]).default("pdf"),
});

const safeName = (value: string) =>
  value
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 70) || "RPH";

const BUCKET = "rph-exports";

export async function POST(request: NextRequest) {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;
  if (!supabaseConfigured) {
    return NextResponse.json(
      { error: "Eksport arkib memerlukan mod disegerakkan." },
      { status: 503 },
    );
  }
  const limited = rateLimit(`export-archive:${gate.user.id}`);
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
      { error: parsed.error.issues[0]?.message ?? "Senarai RPH tidak sah" },
      { status: 422 },
    );
  }

  const ids = [...new Set(parsed.data.documentIds)];
  const loaded = [];
  for (const id of ids) {
    const result = await loadExportDocument(gate.db, id, gate.user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    loaded.push(result);
  }

  const format = parsed.data.format;
  const fontBytes =
    format === "pdf"
      ? new Uint8Array(await readFile(join(process.cwd(), "public", "noto-sans-export.woff")))
      : null;
  const school = await resolveSchool();

  const files: Record<string, Uint8Array> = {};
  const warnings = new Set<string>();
  const manifest: { id: string; file: string; plan_date: string; subject: string }[] = [];

  for (const [index, entry] of loaded.entries()) {
    const doc = entry.doc;
    let content: Uint8Array;
    try {
      if (format === "pdf") {
        if (!fontBytes) throw new Error("Fon PDF tidak dapat dimuatkan.");
        content = await buildRphPdf({
          plan: {
            payload: doc.payload,
            session: doc.session,
            planDate: doc.planDate,
            slotTime: doc.slotTime,
            slotTimeEnd: doc.slotTimeEnd,
            classNames: doc.className === "-" ? [] : doc.className.split(", "),
            subjectName: doc.subjectName,
          },
          seal: entry.seal,
          teacherName: doc.teacherName,
          schoolName: school.school.name,
          fontBytes,
          onWarning: (message) => warnings.add(message),
        });
      } else {
        content = await buildRphDocx({
          payload: doc.payload,
          session: doc.session,
          planDate: doc.planDate,
          className: doc.className,
          subjectName: doc.subjectName,
          slotTime: doc.slotTime,
          slotTimeEnd: doc.slotTimeEnd,
          teacherName: doc.teacherName,
          schoolName: school.school.name,
          signerName: entry.seal?.signerName ?? undefined,
          signerTitle: entry.seal?.signerTitle ?? undefined,
          signedAt: entry.seal?.signedAt,
          signatureAlg: entry.seal?.alg,
          signatureKey: entry.seal?.publicKey,
        });
      }
    } catch (error) {
      return NextResponse.json(
        {
          error: `${doc.planDate} · ${doc.subjectName}: ${
            error instanceof Error ? error.message : "Dokumen gagal dijana"
          }`,
        },
        { status: 500 },
      );
    }

    const name = `${String(index + 1).padStart(3, "0")}-${safeName(doc.planDate)}-${safeName(
      doc.subjectName,
    )}-${safeName(doc.className)}.${format}`;
    // Week folders come from the stored row; the prefix keeps two years' week
    // 3 apart in one ZIP.
    const folder = `Minggu-${String(doc.weekNo).padStart(2, "0")}`;
    const file = `${folder}/${name}`;
    files[file] = content;
    manifest.push({
      id: doc.id,
      file,
      plan_date: doc.planDate,
      subject: doc.subjectName,
    });
  }

  const zipName = `${safeName(parsed.data.name ?? "RPH")}-${format.toUpperCase()}.zip`;
  if (warnings.size > 0) {
    files["AMARAN.txt"] = new TextEncoder().encode(
      [
        "Sesetengah aksara tidak disokong oleh fon PDF dan telah diganti dengan “?”.",
        "",
        ...[...warnings].sort(),
      ].join("\n"),
    );
  }
  files["manifest.json"] = new TextEncoder().encode(
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        plans: manifest,
        warnings: [...warnings].sort(),
      },
      null,
      2,
    ),
  );
  const bytes = zipSync(files, { level: 0 });

  const path = `archive/${randomUUID()}/${zipName}`;
  const { error: uploadErr } = await gate.db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "application/zip", upsert: false });
  if (uploadErr) {
    console.error("[export/archive] upload failed:", uploadErr.message);
    return NextResponse.json(
      { error: "Eksport tidak dapat disimpan untuk audit." },
      { status: 500 },
    );
  }

  const { error: auditErr } = await gate.db.from("export_file").insert({
    document_id: null,
    school_id: school.id || null,
    created_by: gate.user.id,
    bucket: BUCKET,
    path,
    format: "zip",
    bytes: bytes.byteLength,
  });
  if (auditErr) {
    console.error("[export/archive] audit write failed:", auditErr.message);
    const { error: removeErr } = await gate.db.storage.from(BUCKET).remove([path]);
    if (removeErr) console.error("[export/archive] cleanup failed:", removeErr.message);
    return NextResponse.json(
      { error: "Eksport tidak dapat direkodkan untuk audit." },
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${zipName}"`,
      "cache-control": "no-store",
    },
  });
}
