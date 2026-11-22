import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseConfigured } from "@/lib/config";
import { buildRphDocx } from "@/lib/export/docx";
import { rateLimit } from "@/lib/http/rate-limit";
import { aktivitiSchema, rphPayloadSchema } from "@/lib/schemas/rph";
import { requireUser } from "@/lib/server/auth/guard";
import { loadExportDocument } from "@/lib/server/export-document";
import { resolveSchool } from "@/lib/server/school";
import { DB_SCHEMA } from "@/lib/supabase/schema";

/**
 * DOCX export in KPM RPH layout.
 *
 * Deliberately pure-JS (`docx`): headless Chrome does not fit the Vercel free
 * tier (erph-backend-research.md §2.1), and this route must stay inside the
 * 300 s Hobby budget with room to spare. The browser print path is the other
 * supported route - same JSON in, same layout out.
 *
 * POSTs the payload rather than reading by id because in local mode the
 * document only exists in the teacher's IndexedDB, not in Postgres. Works in
 * both modes; when a `document_id` is supplied *and* Supabase is configured,
 * the export is written to `erph.export_file` - RPH is a statutory record
 * (backend §10), so who produced a copy must be answerable.
 */
/** The shared schema, with bounds so one request cannot carry a huge plan. */
const exportPayloadSchema = rphPayloadSchema.extend({
  fasa_tema: z.string().max(2_000).default(""),
  bidang: z.string().max(2_000).default(""),
  tajuk: z.string().max(2_000).default(""),
  standard_kandungan: z.string().max(10_000).default(""),
  standard_pembelajaran: z.string().max(10_000).default(""),
  objektif: z.string().max(10_000).default(""),
  kriteria_kejayaan: z.string().max(10_000).default(""),
  refleksi: z.string().max(10_000).default(""),
  aktiviti: z
    .array(aktivitiSchema.extend({ nama: z.string().max(500) }))
    .max(200)
    .default([]),
});

const bodySchema = z.object({
  document_id: z.string().uuid().optional(),
  payload: exportPayloadSchema,
  session: z.string().max(20),
  // No `teacherName`. The name printed on the paper is the person exporting
  // it, taken from the session below: that is the one source that cannot be a
  // stranger, and the route already refuses to export a document that is not
  // the caller's. It used to be accepted from the body *and* never sent, so
  // every exported DOCX printed a dash in the NAMA row and "Guru: undefined"
  // above it - a blank cell is honest, but this one was avoidable.
  //
  // Every free-text field is bounded. These are the teacher's own words, and
  // some of them end up in a header and a database column: an unbounded one is
  // a megabyte of text in a `content-disposition`, and a quote in it ends the
  // header parameter early.
  schoolName: z.string().max(120).optional(),
  planDate: z.string().max(20).optional(),
  // Up to 30 classes joined with ", " - the joined label of a multi-class
  // plan, not one name. Class names are short (school registers), but the
  // bound has to survive thirty of them, not one long one.
  className: z.string().max(600).optional(),
  subjectName: z.string().max(120).optional(),
  /** Masa Mula / Masa Tamat - both are printed, so both are carried through. */
  slotTime: z.string().max(10).optional(),
  slotTimeEnd: z.string().max(10).optional(),
  /**
   * The seal, carried through to the printed document.
   *
   * Sent by a client that has already verified it in the browser, so the
   * export is a rendering of a checked signature rather than a claim. An
   * export with no signature simply prints the blank reviewer line it always
   * did - an unapproved plan must not look sealed.
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // No `!`: `supabaseConfigured` only proves the URL and anon key exist. A
  // deployment with no server key must get a 503 it can act on, not a
  // TypeError thrown from inside an import. Callers check
  // `hasServerKey()` first; this throw is the backstop, never the path.
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: DB_SCHEMA },
  });
}

/** The server key `supabaseAdmin()` needs - absent in local mode and in a deployment that set the URL but no secret. */
function hasServerKey(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

/**
 * The private bucket the exported copies are kept in.
 *
 * The same name as the bucket db/schema.sql creates, so the path recorded in
 * `erph.export_file` names an object that exists in a bucket that exists -
 * rather than a place where a file might be.
 */
const EXPORT_BUCKET = "rph-exports";

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

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 1_000_000) {
    return NextResponse.json({ error: "Permintaan eksport terlalu besar." }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 413 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Pengesahan data gagal", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Values start from the request only for the local-mode/unsaved export.
  let payload = parsed.data.payload;
  let session = parsed.data.session;
  let planDate = parsed.data.planDate;
  let className = parsed.data.className;
  let subjectName = parsed.data.subjectName;
  let slotTime = parsed.data.slotTime ?? "07:30";
  let slotTimeEnd = parsed.data.slotTimeEnd ?? "12:40";
  let teacherName = gate.user.fullName;
  let signerName = parsed.data.signerName;
  let signerTitle = parsed.data.signerTitle;
  let signedAtRaw = parsed.data.signedAt;
  let signatureAlg = parsed.data.signatureAlg;
  let signatureKey = parsed.data.signatureKey;
  let storedDocumentId = parsed.data.document_id ?? null;

  // The school's name on a printed RPH comes from the row the administrator
  // edits, not from the build - otherwise the document and the screen it was
  // previewed on could name different schools. Resolved here rather than as a
  // zod default because a default has to be a constant.
  const school = await resolveSchool();
  let schoolName = parsed.data.schoolName ?? school.school.name;

  if (supabaseConfigured) {
    // A synced export must name a stored row. Body-supplied content is not a
    // statutory document: it would let a caller render and audit-log a copy
    // that has nothing to do with the id beside it.
    if (!parsed.data.document_id) {
      return NextResponse.json(
        { error: "Eksport dokumen yang disimpan sahaja dibenarkan dalam mod disegerakkan." },
        { status: 422 },
      );
    }
    if (!hasServerKey()) {
      return NextResponse.json(
        { error: "Eksport arkib tidak tersedia - kunci pelayan tiada." },
        { status: 503 },
      );
    }

    const admin = await supabaseAdmin();
    const loaded = await loadExportDocument(admin, parsed.data.document_id, gate.user.id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }

    // Only the stored row describes the document. The request cannot change
    // the payload, class, subject, date, school or signer.
    const doc = loaded.doc;
    payload = doc.payload;
    session = doc.session;
    planDate = doc.planDate;
    className = doc.className;
    subjectName = doc.subjectName;
    slotTime = doc.slotTime;
    slotTimeEnd = doc.slotTimeEnd;
    teacherName = doc.teacherName;
    schoolName = school.school.name;
    storedDocumentId = doc.id;
    signerName = loaded.seal?.signerName ?? undefined;
    signerTitle = loaded.seal?.signerTitle ?? undefined;
    signedAtRaw = loaded.seal?.signedAt;
    signatureAlg = loaded.seal?.alg;
    signatureKey = loaded.seal?.publicKey;
  }

  const buffer = await buildRphDocx({
    payload,
    session,
    planDate,
    className,
    subjectName,
    slotTime,
    slotTimeEnd,
    teacherName,
    schoolName,
    signerName,
    signerTitle,
    signedAt: signedAtRaw,
    signatureAlg,
    signatureKey,
  });

  // The filename goes into a response header, so it is built from text that
  // cannot end the header parameter early. The subject is included so two
  // lessons for the same class on the same day do not share a name.
  const slug = [
    safeName(className ?? "", "rph"),
    safeName(subjectName ?? "", "subjek"),
    safeName(planDate ?? "", "draft"),
  ].join("-");
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
    if (!hasServerKey()) {
      return NextResponse.json(
        { error: "Eksport tidak dapat direkodkan - kunci pelayan tiada." },
        { status: 503 },
      );
    }
    try {
      const admin = await supabaseAdmin();
      // One object per export: a repeated export must not overwrite the copy
      // an earlier audit row describes.
      const path = `${storedDocumentId ?? "adhoc"}/${randomUUID()}-${filename}`;
      const { error: upErr } = await admin.storage
        .from(EXPORT_BUCKET)
        .upload(path, new Uint8Array(buffer), {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: false,
        });
      if (upErr) {
        console.error("[export] could not store the copy:", upErr.message);
        return NextResponse.json(
          { error: "Eksport tidak dapat disimpan untuk audit." },
          { status: 500 },
        );
      }
      const { error } = await admin.from("export_file").insert({
        document_id: storedDocumentId,
        school_id: school.id || null,
        created_by: gate.user.id,
        bucket: EXPORT_BUCKET,
        path,
        format: "docx",
        bytes: buffer.byteLength,
      });
      if (error) {
        console.error("[export] audit write failed:", error.message);
        // Do not leave a copy with no row behind it.
        const { error: removeErr } = await admin.storage.from(EXPORT_BUCKET).remove([path]);
        if (removeErr) console.error("[export] cleanup failed:", removeErr.message);
        return NextResponse.json(
          { error: "Eksport tidak dapat direkodkan untuk audit." },
          { status: 500 },
        );
      }
    } catch (err) {
      console.error("[export] audit write failed:", err);
      return NextResponse.json(
        { error: "Eksport tidak dapat direkodkan untuk audit." },
        { status: 500 },
      );
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
