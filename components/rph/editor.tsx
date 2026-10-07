"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  FileDown,
  Plus,
  Send,
  X,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { RphPaper } from "@/components/rph/rph-paper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/field";
import { HelpHint } from "@/components/ui/help-hint";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import { SESSION, supabaseConfigured } from "@/lib/config";
import { longDate } from "@/lib/date";
import { db } from "@/lib/db";
import { searchDskp } from "@/lib/demo/dskp";
import { CLASSES } from "@/lib/demo/seed";
import { ms } from "@/lib/i18n/ms";
import { RpcError, submitRph } from "@/lib/rpc";
import { completeness, emptyPayload, type RphPayload, stepStatus } from "@/lib/schemas/rph";
import { commit } from "@/lib/sync/queue";
import type { RphDocument } from "@/lib/types";

/**
 * Download the plan as a KPM-formatted DOCX from /api/export.
 *
 * The route is pure JS (`docx`) so it works in local mode too — no Supabase
 * involved. On any failure we fall back to the browser print dialog, which
 * also produces a PDF, so an export is never a dead end.
 */
async function exportDocx(doc: RphDocument): Promise<void> {
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        document_id: doc.id,
        payload: doc.payload,
        session: doc.session,
        planDate: doc.planDate,
        className: doc.className,
        subjectName: doc.subjectName,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`export failed: ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `RPH-${doc.className.replace(/\s+/g, "-")}-${doc.planDate}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("RPH dimuat turun sebagai DOCX");
  } catch {
    toast.info("Eksport gagal — membuka dialog cetak sebagai gantian");
    window.print();
  }
}

const STEPS = [
  { key: "profil", title: ms.editor.step1, sub: ms.editor.step1sub },
  { key: "dskp", title: ms.editor.step2, sub: ms.editor.step2sub },
  { key: "pdpc", title: ms.editor.step3, sub: ms.editor.step3sub },
  { key: "refleksi", title: ms.editor.step4, sub: ms.editor.step4sub },
] as const;

export function RphEditor({ docId }: { docId?: string }) {
  const router = useRouter();
  const params = useParams();
  const id = docId ?? (typeof params.id === "string" ? params.id : undefined);

  /**
   * `useLiveQuery` is what makes the dashboard update the instant the editor
   * saves — both screens subscribe to the same Dexie row, no global store.
   *
   * The discriminated return matters: `undefined` alone can't tell "still
   * loading" apart from "document doesn't exist", and showing a teacher a
   * bogus "not found" while IndexedDB is warming up is a real bug.
   */
  const found = useLiveQuery(async () => {
    if (!id) return { state: "no-id" as const };
    const doc = await db.documents.get(id);
    return doc ? { state: "ok" as const, doc } : { state: "missing" as const };
  }, [id]);

  const live = found?.state === "ok" ? found.doc : undefined;

  const [step, setStep] = React.useState(0);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const update = React.useCallback(
    async (patch: Partial<RphDocument>) => {
      if (!live) return;
      setSaving(true);
      try {
        // commit() writes to Dexie first (optimistic, instant for the UI) and
        // queues the network sync in the background.
        await commit({ ...live, ...patch, clientUpdatedAt: Date.now() });
      } finally {
        setSaving(false);
      }
    },
    [live],
  );

  const updatePayload = React.useCallback(
    (patch: Partial<RphPayload>) => {
      if (!live) return;
      void update({ payload: { ...live.payload, ...patch } });
    },
    [live, update],
  );

  if (!id) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="mb-4 text-ink-3">Tiada RPH dipilih.</p>
          <Button onClick={() => router.push("/minggu")}>Kembali ke Minggu Ini</Button>
        </CardContent>
      </Card>
    );
  }

  if (found === undefined) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-ink-4">Memuatkan…</CardContent>
      </Card>
    );
  }

  if (found.state !== "ok" || !live) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="mb-4 text-ink-3">RPH tidak dijumpai.</p>
          <Button onClick={() => router.push("/minggu")}>Kembali ke Minggu Ini</Button>
        </CardContent>
      </Card>
    );
  }

  const payload = live.payload ?? emptyPayload();
  const score = completeness(payload);
  const flags = stepStatus(payload);
  const stepDone = [flags.profil, flags.dskp, flags.pdpc, flags.refleksi];

  const canSubmit = score === 100;

  const onSubmit = async (force: boolean) => {
    // Offline-first: never block a teacher on a network hiccup. When we ARE
    // online and configured, the server is authoritative — `submit_rph` owns
    // the completeness rule (backend §3.3 decision 4) and may disagree with
    // our local meter. If it refuses, show the gate instead of submitting.
    if (supabaseConfigured && navigator.onLine) {
      try {
        const verdict = await submitRph(live.id, force);
        if (verdict && !verdict.ok) {
          setSubmitOpen(true);
          return;
        }
      } catch (err) {
        // An expired session is NOT a network hiccup: claiming "Dihantar"
        // while the server never saw it would be a lie. Send them to re-auth.
        if (err instanceof RpcError && err.isAuthFailure) {
          toast.error("Sesi anda telah tamat. Sila log masuk semula.");
          window.setTimeout(() => window.location.assign("/login"), 1200);
          return;
        }
        // Genuine network/DB hiccup: fall through and submit locally.
        // sync_rph applies the same 100% gate server-side, so this cannot
        // become a bypass — it just queues the submission for when we reconnect.
      }
    } else if (score < 100 && !force) {
      setSubmitOpen(true);
      return;
    }

    await update({ status: "submitted", submittedAt: Date.now(), grade: undefined });
    setSubmitOpen(false);
    toast.success("Dihantar untuk semakan · status: Menunggu");
    router.push("/minggu");
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_390px]">
      {/* ══ Left: the wizard ════════════════════════════════════════════ */}
      <Card className="self-start overflow-hidden">
        {/* Stepper */}
        <ol className="flex gap-0.5 overflow-x-auto border-b border-border bg-surface-2 px-4 py-3.5">
          {STEPS.map((s, i) => {
            const done = i < step && stepDone[i];
            const current = i === step;
            return (
              <li key={s.key} className="relative min-w-[150px] flex-1">
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left"
                  aria-current={current ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold transition-colors",
                      done
                        ? "border-success bg-success text-white"
                        : current
                          ? "border-primary bg-primary text-white shadow-[0_0_0_4.5px_var(--color-primary-soft)]"
                          : "border-border-strong bg-surface text-ink-3",
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block truncate text-[13px] font-semibold",
                        current ? "text-primary-ink" : done ? "text-ink-2" : "text-ink-3",
                      )}
                    >
                      {s.title}
                    </span>
                    <span
                      className={cn(
                        "block truncate text-[10.5px]",
                        current ? "text-primary-ink" : "text-ink-4",
                      )}
                    >
                      {s.sub}
                    </span>
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <span
                    className={cn(
                      "absolute top-4 right-0 left-9 h-0.5",
                      i < step ? "bg-success-line" : "bg-border",
                    )}
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>

        <CardContent className="py-5">
          {/* Autosave status — always visible, never a Save button that can fail */}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">
                Langkah {step + 1} · {STEPS[step]?.title}
              </h2>
              <p className="text-[12.5px] text-ink-3">
                {live.subjectName} · {live.className} ·{" "}
                <span className="num">
                  {longDate(live.planDate)} · {live.slotTime}
                </span>
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-3">
              <span
                className={cn(
                  "h-1.75 w-1.75 rounded-full",
                  saving ? "bg-warning" : "bg-success",
                )}
                aria-hidden
              />
              {saving ? "Menyimpan…" : `${ms.status.saving} · ${ms.status.online}`}
            </span>
          </div>

          {/* Completeness meter */}
          <div className="mb-5 flex items-center gap-3 rounded-[11px] border border-border bg-surface-2 p-3">
            <span className="text-[19px] font-extrabold tracking-[-0.6px] text-primary-ink num">
              {score}%
            </span>
            <div>
              <p className="mb-1.5 text-[12.5px] font-semibold">
                {ms.editor.completeness}{" "}
                <span className="font-normal text-ink-3">
                  — {Object.values(flags).filter(Boolean).length} daripada 4 bahagian
                </span>{" "}
                <HelpHint label="Keluargaan dokumen">
                  Empat bahagian wajib mengikut Garis Panduan e-RPH KPM: (1) Standard Kandungan
                  + Standard Pembelajaran + objektif, (2) sekurang-kurangnya satu aktiviti PdPc,
                  (3) refleksi, (4) intervensi <b>atau</b> elemen EMK. Setiap bahagian = 25%.
                </HelpHint>
              </p>
              <Progress value={score} tone={score === 100 ? "success" : "primary"} />
            </div>
            {score < 100 && <Badge variant="warning">Belum lengkap</Badge>}
            {score === 100 && <Badge variant="success">Sedia dihantar</Badge>}
          </div>

          {step === 0 && <StepProfil doc={live} onPatch={update} />}
          {step === 1 && <StepDskp payload={payload} onPatch={updatePayload} />}
          {step === 2 && <StepPdPc payload={payload} onPatch={updatePayload} />}
          {step === 3 && <StepRefleksi payload={payload} onPatch={updatePayload} />}
        </CardContent>

        {/* §4.2(9) "sticky primary action": keeps the wizard controls reachable
            on long forms, and `bottom-14` lifts it clear of the mobile nav. */}
        <div className="sticky bottom-14 z-10 flex items-center gap-2.5 border-t border-border bg-surface-2 px-4 py-3 lg:bottom-0 lg:rounded-b-[14px]">
          <Button
            variant="secondary"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.9} aria-hidden /> Kembali
          </Button>
          <Button variant="ghost" onClick={() => toast("Draf disimpan pada peranti & awan")}>
            Simpan draf
          </Button>
          <span className="ml-auto num text-[12.5px] text-ink-3">
            Langkah {step + 1} daripada {STEPS.length}
          </span>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)}>Seterusnya →</Button>
          ) : (
            <Button onClick={() => void onSubmit(false)} disabled={!canSubmit}>
              <Send className="h-4 w-4" strokeWidth={1.9} aria-hidden /> Hantar
            </Button>
          )}
        </div>
      </Card>

      {/* ══ Right: preview + actions ════════════════════════════════════ */}
      <div className="self-start">
        <div className="mb-3 flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={() => {
              // Browser print → "Save as PDF". Works offline, and RphPaper is
              // styled at KPM proportions (§4.2(8) print/PDF fidelity).
              toast.info("Pilih “Simpan sebagai PDF” dalam dialog cetak");
              window.print();
            }}
          >
            <Download className="h-4 w-4" strokeWidth={1.9} aria-hidden />
            PDF
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={() => void exportDocx(live)}
          >
            <FileDown className="h-4 w-4" strokeWidth={1.9} aria-hidden />
            DOCX
          </Button>
          <Button size="sm" className="flex-1" onClick={() => void onSubmit(false)}>
            <Send className="h-4 w-4" strokeWidth={1.9} aria-hidden />
            {ms.editor.submit}
          </Button>
        </div>

        <p className="mb-2 flex items-center gap-2 text-[12px] font-bold tracking-[0.6px] text-ink-4 uppercase">
          <span className="h-px flex-1 bg-border" />
          {ms.editor.preview}
          <span className="h-px flex-1 bg-border" />
        </p>

        <RphPaper payload={payload} session={SESSION} />

        {!canSubmit && (
          <div className="mt-3 flex gap-2.5 rounded-[10px] border border-warning-line bg-warning-soft p-3 text-[12.5px] leading-[1.55] text-warning-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
            <div>{ms.editor.missingReflection}</div>
          </div>
        )}
      </div>

      {/* ══ Submit gate dialog ══════════════════════════════════════════ */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogHeader>
          <DialogTitle>Hantar RPH untuk semakan?</DialogTitle>
          <DialogDescription>
            {live.className} · {live.subjectName} · {longDate(live.planDate)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <dl className="text-[13px]">
            <Row
              k="Bahagian lengkap"
              v={`${Object.values(flags).filter(Boolean).length} / 4`}
            />
            <Row
              k="Refleksi & Intervensi"
              v={flags.refleksi ? "Lengkap" : "Belum diisi"}
              tone={flags.refleksi ? "ok" : "bad"}
            />
            <Row k="Penyemak" v="Zulkifli · GPK Pentadbiran" />
            <Row k="Kesiapan" v={`${score}%`} tone={score === 100 ? "ok" : "warn"} />
          </dl>
          <div className="mt-3.5 flex gap-2.5 rounded-[10px] border border-warning-line bg-warning-soft p-3 text-[12.5px] leading-[1.55] text-warning-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
            <div>
              Bahagian Refleksi belum diisi. Dokumen boleh dihantar sebagai{" "}
              <b>draf tidak lengkap</b>, tetapi GPK mungkin mengembalikannya (gred 0).
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setSubmitOpen(false)}>
            Batal
          </Button>
          <Button variant="danger" onClick={() => void onSubmit(true)}>
            Hantar sebagai draf
          </Button>
          <Button
            onClick={() => {
              setSubmitOpen(false);
              setStep(3);
            }}
          >
            Lengkapkan sekarang
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-border py-2 last:border-b-0">
      <dt className="text-ink-3">{k}</dt>
      <dd
        className="font-bold"
        style={{
          color:
            tone === "ok"
              ? "var(--color-success-ink)"
              : tone === "bad"
                ? "var(--color-danger-ink)"
                : tone === "warn"
                  ? "var(--color-warning-ink)"
                  : undefined,
        }}
      >
        {v}
      </dd>
    </div>
  );
}

/* ══ Step 1 · Profil ═══════════════════════════════════════════════════ */

function StepProfil({
  doc,
  onPatch,
}: {
  doc: RphDocument;
  onPatch: (p: Partial<RphDocument>) => void;
}) {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="f-14796">{ms.editor.subject}</Label>
          <Select
            id="f-14796"
            value={doc.subjectCode}
            onChange={(e) => {
              const name =
                e.target.value === "MAT"
                  ? "Matematik"
                  : e.target.value === "BM"
                    ? "Bahasa Melayu"
                    : "Sains";
              onPatch({ subjectCode: e.target.value, subjectName: name });
            }}
          >
            <option value="MAT">Matematik</option>
            <option value="BM">Bahasa Melayu</option>
            <option value="SAIN">Sains</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="f-733697">{ms.editor.class}</Label>
          <Select
            id="f-733697"
            value={doc.classId}
            onChange={(e) => {
              const cls = CLASSES.find((c) => c.id === e.target.value);
              if (cls) onPatch({ classId: cls.id, className: cls.nama });
            }}
          >
            {CLASSES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nama}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-807586">{ms.editor.date}</Label>
          <Input
            id="f-807586"
            type="date"
            className="num"
            value={doc.planDate}
            onChange={(e) => onPatch({ planDate: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="f-795300">{ms.editor.time}</Label>
          <Input
            id="f-795300"
            type="time"
            className="num"
            value={doc.slotTime}
            onChange={(e) => onPatch({ slotTime: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="f-311133">{ms.editor.students}</Label>
          <Input
            id="f-311133"
            type="number"
            min={0}
            max={100}
            className="num"
            value={doc.payload.bilangan_murid ?? ""}
            onChange={(e) =>
              onPatch({
                payload: {
                  ...doc.payload,
                  bilangan_murid: e.target.value === "" ? undefined : Number(e.target.value),
                },
              })
            }
          />
        </div>
        <div>
          <Label htmlFor="f-995730">Fasa / Tema</Label>
          <Input
            id="f-995730"
            value={doc.payload.fasa_tema ?? ""}
            placeholder="Nombor & Operasi"
            onChange={(e) =>
              onPatch({ payload: { ...doc.payload, fasa_tema: e.target.value } })
            }
          />
        </div>
      </div>
    </div>
  );
}

/* ══ Step 2 · DSKP ════════════════════════════════════════════════════ */

function StepDskp({
  payload,
  onPatch,
}: {
  payload: RphPayload;
  onPatch: (p: Partial<RphPayload>) => void;
}) {
  const [term, setTerm] = React.useState("");
  const [open, setOpen] = React.useState(true);
  const results = searchDskp(term);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="relative">
        <Label required htmlFor="f-188949">
          {ms.editor.standardKandungan}
        </Label>
        <Input
          id="f-188949"
          value={term || payload.standard_kandungan}
          placeholder="Cari Standard Kandungan…"
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
            onPatch({ standard_kandungan: e.target.value, kod_sk: "" });
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          aria-expanded={open}
          aria-controls="dskp-results"
        />

        {open && results.length > 0 && (
          <ul
            id="dskp-results"
            className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-[9px] border border-border bg-surface shadow-md"
          >
            {results.map((d) => {
              const selected = payload.kod_sk === d.kodSk;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={
                      "flex w-full gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 " +
                      (selected
                        ? "bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)]"
                        : "hover:bg-surface-2")
                    }
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPatch({
                        kod_sk: d.kodSk,
                        standard_kandungan: d.standardKandungan,
                        bidang: d.bidang,
                        // Selecting an SK narrows the SP list automatically.
                        kod_sp: "",
                        standard_pembelajaran: "",
                      });
                      setTerm("");
                      setOpen(false);
                    }}
                  >
                    <span
                      className={
                        "min-w-[50px] pt-0.5 text-[10.5px] font-bold tracking-[0.4px] " +
                        (selected ? "text-primary-ink" : "text-ink-4")
                      }
                    >
                      SK {d.kodSk}
                    </span>
                    <span className="text-[13px] leading-[1.45] text-ink-2">
                      {d.standardKandungan}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-4">
          Daripada DSKP KSSR Semakan · disediakan luar talian
          <HelpHint label="Pemilih DSKP">
            Taip untuk mencari mengikut kod (3.1), teks Standard Kandungan, atau bidang. Pilihan
            SK akan menapis senarai SP secara automatik — jangan taip SK/SP sebagai teks bebas.
          </HelpHint>
        </p>
      </div>

      <div>
        <Label required htmlFor="f-907255">
          {ms.editor.standardPembelajaran}
        </Label>
        {payload.kod_sk ? (
          <Select
            id="f-907255"
            value={payload.kod_sp ?? ""}
            onChange={(e) => {
              const d = searchDskp(e.target.value, 1)[0];
              // Value is the kod_sp; look it up to fill the full text.
              const found = searchDskp("", 99).find((x) => x.kodSp === e.target.value);
              if (found) {
                onPatch({
                  kod_sp: found.kodSp,
                  standard_pembelajaran: `${found.kodSp} ${found.standardPembelajaran}`,
                });
              } else if (d) {
                onPatch({ kod_sp: e.target.value, standard_pembelajaran: e.target.value });
              }
            }}
          >
            <option value="">— pilih Standard Pembelajaran —</option>
            {searchDskp("", 99)
              .filter((x) => x.kodSk === payload.kod_sk)
              .map((x) => (
                <option key={x.kodSp} value={x.kodSp}>
                  {x.kodSp} {x.standardPembelajaran}
                </option>
              ))}
          </Select>
        ) : (
          <p className="rounded-[9px] border border-dashed border-border-strong px-3 py-2.5 text-[13px] text-ink-4">
            Pilih Standard Kandungan dahulu.
          </p>
        )}

        <div className="mt-3.5">
          <Label required htmlFor="f-675227">
            {ms.editor.objective}
          </Label>
          <Textarea
            id="f-675227"
            value={payload.objektif}
            placeholder="Murid dapat…"
            onChange={(e) => onPatch({ objektif: e.target.value })}
          />
          {payload.objektif.trim() === "" && (
            <FieldError>Objektif diperlukan sebelum dihantar.</FieldError>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══ Step 3 · PdPc ════════════════════════════════════════════════════ */

const EMK_OPTIONS = [
  "Kerjasama",
  "Kreativiti",
  "Nilai Murni: Amanah",
  "Nilai Murni: Bertanggungjawab",
  "KBAT · Analisis",
  "PAK-21 · Berfikir Aras Tinggi",
];

function StepPdPc({
  payload,
  onPatch,
}: {
  payload: RphPayload;
  onPatch: (p: Partial<RphPayload>) => void;
}) {
  const totalMin = payload.aktiviti.reduce((sum, a) => {
    const n = Number.parseInt(a.masa, 10);
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);

  const setAktiviti = (
    i: number,
    field: keyof RphPayload["aktiviti"][number],
    value: string,
  ) => {
    const next = payload.aktiviti.map((a, idx) => (idx === i ? { ...a, [field]: value } : a));
    onPatch({ aktiviti: next });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Label className="mb-0">{ms.editor.activities}</Label>
        <span className="num text-[12px] text-ink-3">
          Jumlah masa aktif: <b className="text-ink">{totalMin} min</b>
          {totalMin === 50 && " (sesuai 1 waktu pengajaran)"}
        </span>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2">
              {["Masa", "Aktiviti guru", "Aktiviti murid", ""].map((h) => (
                <th
                  key={h}
                  className="border-b border-border px-3 py-2 text-left text-[11px] font-bold tracking-[0.7px] text-ink-4 uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payload.aktiviti.map((a, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="w-20 px-2 py-2">
                  <Input
                    className="num px-2 py-1.5 text-[12.5px]"
                    value={a.masa}
                    placeholder="10 min"
                    onChange={(e) => setAktiviti(i, "masa", e.target.value)}
                    aria-label={`Masa aktiviti ${i + 1}`}
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    className="px-2 py-1.5 text-[12.5px]"
                    value={a.aktiviti_guru}
                    onChange={(e) => setAktiviti(i, "aktiviti_guru", e.target.value)}
                    aria-label={`Aktiviti guru ${i + 1}`}
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    className="px-2 py-1.5 text-[12.5px]"
                    value={a.aktiviti_murid}
                    onChange={(e) => setAktiviti(i, "aktiviti_murid", e.target.value)}
                    aria-label={`Aktiviti murid ${i + 1}`}
                  />
                </td>
                <td className="w-10 px-2 py-2 text-center">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-ink-4 transition-colors hover:bg-danger-soft hover:text-danger-ink"
                    onClick={() =>
                      onPatch({ aktiviti: payload.aktiviti.filter((_, x) => x !== i) })
                    }
                    aria-label={`Buang aktiviti ${i + 1}`}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                  </button>
                </td>
              </tr>
            ))}
            {payload.aktiviti.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-ink-4">
                  Tiada aktiviti lagi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Button
        variant="secondary"
        size="sm"
        className="mt-2.5"
        onClick={() =>
          onPatch({
            aktiviti: [
              ...payload.aktiviti,
              { masa: "", aktiviti_guru: "", aktiviti_murid: "" },
            ],
          })
        }
      >
        <Plus className="h-4 w-4" strokeWidth={2.1} aria-hidden /> Tambah aktiviti
      </Button>

      <div className="mt-5">
        <Label>{ms.editor.emk}</Label>
        <div className="flex flex-wrap gap-2">
          {EMK_OPTIONS.map((opt) => {
            const on = payload.emk.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onPatch({
                    emk: on ? payload.emk.filter((x) => x !== opt) : [...payload.emk, opt],
                  })
                }
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors " +
                  (on
                    ? "border-primary-soft-2 bg-primary-soft text-primary-ink"
                    : "border-dashed border-border-strong bg-surface text-ink-3 hover:border-primary hover:text-primary-ink")
                }
              >
                {opt}
                <span aria-hidden className="opacity-70">
                  {on ? "✕" : "+"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══ Step 4 · Refleksi ════════════════════════════════════════════════ */

function StepRefleksi({
  payload,
  onPatch,
}: {
  payload: RphPayload;
  onPatch: (p: Partial<RphPayload>) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <Label required htmlFor="f-270580">
          {ms.editor.reflection}
        </Label>
        <Textarea
          id="f-270580"
          value={payload.refleksi}
          placeholder="Apa yang berlaku? Murid mana perlu perhatian?"
          onChange={(e) => onPatch({ refleksi: e.target.value })}
        />
        {payload.refleksi.trim() === "" && (
          <FieldError>Refleksi diperlukan sebelum dihantar.</FieldError>
        )}
      </div>
      <div>
        <Label htmlFor="f-305006">Intervensi</Label>
        <Textarea
          id="f-305006"
          value={payload.intervensi}
          placeholder="Langkah susulan untuk murid yang lemah…"
          onChange={(e) => onPatch({ intervensi: e.target.value })}
        />
        <p className="mt-1.5 text-[11.5px] text-ink-4">
          Isi intervensi <b>atau</b> sekurang-kurangnya satu elemen EMK untuk memenuhi keperluan
          keluargaan.
        </p>
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="f-491570">Nota KBAT / PAK-21</Label>
        <Textarea
          id="f-491570"
          className="min-h-18"
          value={payload.kbat}
          placeholder="Soalan aras tinggi yang anda gunakan…"
          onChange={(e) => onPatch({ kbat: e.target.value })}
        />
      </div>
    </div>
  );
}
