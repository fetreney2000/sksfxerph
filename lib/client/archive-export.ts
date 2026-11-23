"use client";

import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { supabaseConfigured } from "@/lib/config";
import { buildRphPdf } from "@/lib/export/pdf";
import { payloadHash, verifySignature } from "@/lib/signature";
import type { RphDocument } from "@/lib/types";

const safeName = (value: string) =>
  value
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 70) || "RPH";

/** A hard ceiling so one accidental "whole session" cannot exhaust memory. */
export const MAX_ZIP_PLANS = 200;
const DOCX_TIMEOUT_MS = 30_000;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(DOCX_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function signatureFor(doc: RphDocument): Promise<SignaturePayload | null> {
  if (!supabaseConfigured || doc.status !== "approved") return null;
  const response = await fetch(`/api/rph/${encodeURIComponent(doc.id)}/signature`);
  if (!response.ok) throw new Error("Tandatangan tidak dapat dimuatkan.");
  const { signature } = (await response.json()) as { signature: SignaturePayload | null };
  if (!signature) throw new Error("RPH yang disahkan tidak mempunyai tandatangan.");
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
  signal?: AbortSignal,
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
      signal: requestSignal(signal),
    });
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (response.status !== 429 || attempt === 2) {
      throw new Error(`Eksport DOCX gagal (HTTP ${response.status}).`);
    }
    const retry = Number(response.headers.get("retry-after"));
    onProgress("Menunggu had eksport pelayan sebelum meneruskan…");
    await wait(Math.min(65, Math.max(1, retry || 60)) * 1000, signal);
  }
  throw new Error("Eksport DOCX gagal.");
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadArchiveZip(
  plans: RphDocument[],
  name: string,
  teacherName: string,
  schoolName: string,
  format: "pdf" | "docx",
  onProgress: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!plans.length) throw new Error("Tiada RPH untuk dimuat turun.");
  if (plans.length > MAX_ZIP_PLANS) {
    throw new Error(
      `Eksport ZIP terhad kepada ${MAX_ZIP_PLANS} RPH. Pilih minggu atau pecahkan sesi kepada beberapa muat turun.`,
    );
  }
  signal?.throwIfAborted();

  // Synced archives are generated and recorded on the server in one
  // transaction-like job: a browser-only archive left no audit row, and a
  // per-file DOCX loop left earlier copies behind when a later plan failed.
  // Local mode keeps the client-generated path below.
  if (supabaseConfigured) {
    onProgress(`Menyediakan ZIP ${format.toUpperCase()} dan merekod eksport…`);
    const response = await fetch("/api/export/archive", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentIds: plans.map((plan) => plan.id),
        name,
        format,
      }),
      signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(
        body?.error ?? `Eksport ZIP ${format.toUpperCase()} gagal (HTTP ${response.status}).`,
      );
    }
    saveBlob(await response.blob(), `${safeName(name)}-${format.toUpperCase()}.zip`);
    return;
  }

  let fontBytes: Uint8Array | null = null;
  if (format === "pdf") {
    const fontResponse = await fetch("/noto-sans-export.woff", { signal });
    if (!fontResponse.ok) throw new Error("Fon PDF tidak dapat dimuatkan.");
    fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
  }
  const files: Record<string, Uint8Array> = {};
  const warnings = new Set<string>();
  const ordered = [...plans].sort(
    (a, b) =>
      a.weekNo - b.weekNo || a.planDate.localeCompare(b.planDate) || a.id.localeCompare(b.id),
  );
  for (const [index, doc] of ordered.entries()) {
    signal?.throwIfAborted();
    onProgress(`Menyediakan RPH ${index + 1} daripada ${ordered.length}…`);
    try {
      const seal = await signatureFor(doc);
      let content: Uint8Array;
      if (format === "pdf") {
        if (!fontBytes) throw new Error("Fon PDF tidak dapat dimuatkan.");
        content = await buildRphPdf({
          plan: doc,
          seal,
          teacherName,
          schoolName,
          fontBytes,
          onWarning: (message) => warnings.add(message),
        });
      } else {
        content = await docxFor(doc, seal, onProgress, signal);
      }
      signal?.throwIfAborted();
      const path = `Minggu-${String(doc.weekNo).padStart(2, "0")}/${String(index + 1).padStart(3, "0")}-${safeName(doc.planDate)}-${safeName(doc.subjectName)}-${safeName(doc.classNames.join("-"))}`;
      files[`${path}.${format}`] = content;
    } catch (error) {
      throw new Error(
        `${doc.planDate} · ${doc.subjectName}: ${error instanceof Error ? error.message : "eksport gagal"}`,
      );
    }
  }
  if (warnings.size > 0) {
    files["AMARAN.txt"] = new TextEncoder().encode(
      [
        "Sesetengah aksara tidak disokong oleh fon PDF dan telah diganti dengan “?”.",
        "",
        ...[...warnings].sort(),
      ].join("\n"),
    );
  }
  signal?.throwIfAborted();
  onProgress("Menyediakan fail ZIP…");
  const { zip } = await import("fflate");
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 6 }, (err, result) => (err ? reject(err) : resolve(result))),
  );
  saveBlob(
    // `BlobPart` types exclude a possibly-shared ArrayBuffer, but the bytes
    // here are a plain ZIP result. Passing the view avoids a second full copy.
    new Blob([bytes as unknown as BlobPart], { type: "application/zip" }),
    `${safeName(name)}-${format.toUpperCase()}.zip`,
  );
}
