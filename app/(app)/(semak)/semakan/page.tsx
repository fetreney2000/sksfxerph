"use client";

import { Check, Info, MessageSquare, Undo2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { RphPaper } from "@/components/rph/rph-paper";
import { useUser } from "@/components/shell/user-context";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reviewStageFor } from "@/lib/auth/permissions";
import { cn } from "@/lib/cn";
import { supabaseConfigured } from "@/lib/config";
import { longDate } from "@/lib/date";
import { useReviewQueueData, useSchoolStats } from "@/lib/hooks/use-remote";
import { useSchool } from "@/lib/hooks/use-school";
import { useSession } from "@/lib/hooks/use-session";
import { ms } from "@/lib/i18n/ms";
import { completeness, stepStatus } from "@/lib/schemas/rph";
import { decide as decideRph, type ReviewDecision } from "@/lib/signature/review";

/**
 * Review queue — the admin screen.
 *
 * Keyboard-first on purpose: a GPK grades 40–60 plans a week, so `J`/`K` to
 * move and `1`/`0` to decide (the exact grades from Lampiran 7 of the KPM
 * Garis Panduan) is the difference between a 5-minute job and a 30-minute one.
 */
/** The message shown after a decision. Both reviewers now end the flow. */
function decisionMessage(decision: "sahkan" | "hantar_balik"): string {
  if (decision === "hantar_balik") return "Tidak lengkap — dikembalikan kepada guru";
  return "Disahkan dan ditandatangani — guru dimaklumkan";
}

export default function SemakanPage() {
  // Remote when configured, bundled demo otherwise — same shape either way.
  const { id: meId, role } = useUser();
  const session = useSession();
  const school = useSchool();
  const stage = reviewStageFor(role);
  const { items: QUEUE } = useReviewQueueData(stage?.status ?? null);
  const stats = useSchoolStats();
  const [selected, setSelected] = React.useState<string | undefined>(QUEUE[0]?.id);
  const [graded, setGraded] = React.useState<Record<string, 0 | 1>>({});
  const [comment, setComment] = React.useState("");
  const [filter, setFilter] = React.useState<"belum" | "semua">("belum");
  /**
   * Latches the decision controls while a request is in flight.
   *
   * Without it, a second click on "Sahkan" signs and posts again — and before
   * the server-side fix, the loser of that race reported a 500 for an approval
   * that had in fact gone through. The queue advances optimistically, so this
   * only re-enables the buttons once the first request has actually settled.
   */
  const [deciding, setDeciding] = React.useState(false);

  // Selection must follow the data: the queue resolves asynchronously in
  // synced mode, so a value captured at first render can be stale.
  React.useEffect(() => {
    if (!selected && QUEUE.length > 0) setSelected(QUEUE[0]?.id);
  }, [QUEUE, selected]);

  const item = QUEUE.find((q) => q.id === selected) ?? QUEUE[0];

  const visible = React.useMemo(
    () => (filter === "belum" ? QUEUE.filter((q) => !(q.id in graded)) : QUEUE),
    [filter, graded, QUEUE],
  );

  const decide = React.useCallback(
    (decision: ReviewDecision) => {
      if (!item || deciding) return;
      setDeciding(true);

      // Server owns the decision when configured: sahkan_rph / hantar_balik_rph
      // write the review, the notification to the teacher and the audit row,
      // and sahkan_rph refuses unless a verified signature is already on file —
      // so an approval here means the browser has signed it first. Local mode
      // updates the demo queue only.
      if (supabaseConfigured) {
        void decideRph({
          userId: meId,
          documentId: item.id,
          version: item.version,
          payload: item.payload,
          decision,
          comment: comment || undefined,
        })
          .then(() => toast.success(decisionMessage(decision)))
          .catch((err: unknown) =>
            toast.error(
              `Gagal menyemak: ${err instanceof Error ? err.message : "ralat rangkaian"}`,
            ),
          )
          .finally(() => setDeciding(false));
      } else {
        toast.success(decisionMessage(decision));
        setDeciding(false);
      }

      setGraded((g) => ({ ...g, [item.id]: decision === "sahkan" ? 1 : 0 }));
      setComment("");
      // Advance to the next ungraded item — the queue is the whole workflow.
      const next = QUEUE.find((q) => !(q.id in graded) && q.id !== item.id);
      if (next) setSelected(next.id);
    },
    [item, deciding, graded, comment, QUEUE, meId],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "1") decide("sahkan");
      if (e.key === "0") decide("hantar_balik");
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const idx = visible.findIndex((q) => q.id === selected);
        const delta = e.key === "j" ? 1 : -1;
        const next = visible[Math.max(0, Math.min(visible.length - 1, idx + delta))];
        if (next) setSelected(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, visible, selected]);

  const flags = item ? stepStatus(item.payload) : null;
  const score = item ? completeness(item.payload) : 0;

  return (
    <>
      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label={ms.review.pending}
          value={String(QUEUE.length - Object.keys(graded).length)}
          tone="warn"
        />
        <Kpi
          label="Lengkap (1)"
          value={String(Object.values(graded).filter((g) => g === 1).length)}
          tone="ok"
        />
        <Kpi
          label="Tidak lengkap (0)"
          value={String(Object.values(graded).filter((g) => g === 0).length)}
          tone="bad"
        />
        <Kpi
          label="Pematuhan sekolah"
          value={`${stats.compliancePct}%`}
          tone="ok"
          bar={stats.compliancePct}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[336px_1fr] items-start">
        {/* ── Queue ──────────────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardHeader className="flex-wrap gap-2.5">
            <CardTitle>{ms.review.queue}</CardTitle>
            <span className="ml-auto flex items-center gap-1.5">
              <kbd className="rounded-md border border-border-strong bg-surface-3 px-1.5 py-px font-mono text-[10.5px] font-semibold text-ink-3">
                J
              </kbd>
              <kbd className="rounded-md border border-border-strong bg-surface-3 px-1.5 py-px font-mono text-[10.5px] font-semibold text-ink-3">
                K
              </kbd>
              <span className="text-[11.5px] text-ink-4">{ms.review.keyboardHint}</span>
            </span>
          </CardHeader>

          <div className="border-b border-border px-4 py-3">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as "belum" | "semua")}>
              <TabsList>
                <TabsTrigger value="belum">
                  Belum semak ({QUEUE.length - Object.keys(graded).length})
                </TabsTrigger>
                <TabsTrigger value="semua">Semua ({QUEUE.length})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="mt-2.5 flex items-center gap-2 text-[11.5px] text-ink-4">
              <kbd className="rounded-md border border-border-strong bg-surface-3 px-1.5 py-px font-mono font-semibold text-ink-3">
                1
              </kbd>
              {ms.review.approveHint}
              <kbd className="rounded-md border border-border-strong bg-surface-3 px-1.5 py-px font-mono font-semibold text-ink-3">
                0
              </kbd>
              {ms.review.grade0}
            </div>
          </div>

          <div className="max-h-[560px] overflow-y-auto">
            {visible.map((q) => {
              const g = graded[q.id];
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setSelected(q.id)}
                  className={cn(
                    "flex w-full gap-2.5 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0",
                    selected === q.id
                      ? "bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)]"
                      : "hover:bg-surface-2",
                  )}
                >
                  <Avatar initials={q.initials} tone={q.tone} small />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">
                      {q.teacherName.split(" ")[0]} · {q.className}
                    </span>
                    <span className="block text-[11.5px] text-ink-3">
                      {q.subjectName} · {longDate(q.planDate)}
                    </span>
                    <span className="block text-[11.5px] text-ink-4">{q.ageLabel}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1.5">
                    {g === undefined ? (
                      <Badge variant="info">Baru</Badge>
                    ) : g === 1 ? (
                      <Badge variant="success">Lengkap</Badge>
                    ) : (
                      <Badge variant="danger">Baiki</Badge>
                    )}
                  </span>
                </button>
              );
            })}
            {visible.length === 0 && (
              <p className="px-4 py-10 text-center text-[13px] text-ink-4">
                Semua RPH sudah disemak. 👍
              </p>
            )}
          </div>
        </Card>

        {/* ── Document + decision ────────────────────────────────────────── */}
        {item && (
          <Card>
            <CardHeader>
              <Avatar initials={item.initials} tone={item.tone} />
              <div className="min-w-0">
                <CardTitle>
                  {item.teacherName} · {item.className}
                </CardTitle>
                <p className="text-xs text-ink-3">
                  {item.subjectName} ·{" "}
                  <span className="num">
                    {longDate(item.planDate)} · {item.slotTime}
                  </span>{" "}
                  · {item.ageLabel}
                </p>
              </div>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => toast("Buka dokumen penuh")}>
                  Buka penuh
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => toast("Dijanakan semula sebagai PDF")}
                >
                  PDF
                </Button>
              </span>
            </CardHeader>

            <CardContent className="grid gap-4 xl:grid-cols-[1fr_300px]">
              <RphPaper
                payload={item.payload}
                session={session}
                schoolName={school.name}
                teacherName={item.teacherName}
              />

              <div>
                {/* Auto-check — mirrors the checklist `review_rph()` stores */}
                <div className="mb-3 rounded-[11px] border border-border bg-surface-2 p-3.5">
                  <p className="mb-2.5 text-[11px] font-bold tracking-[0.7px] text-ink-4 uppercase">
                    {ms.review.autoCheck}
                  </p>
                  {flags &&
                    // Exactly the six rows the printed form cannot be
                    // issued without — not the editor's step grouping, which
                    // is about where a teacher is in the form rather than
                    // what the reviewer will actually receive.
                    (
                      [
                        ["Standard Kandungan", item.payload.standard_kandungan.trim() !== ""],
                        [
                          "Standard Pembelajaran",
                          item.payload.standard_pembelajaran.trim() !== "",
                        ],
                        ["Objektif", item.payload.objektif.trim() !== ""],
                        ["Kriteria Kejayaan", item.payload.kriteria_kejayaan.trim() !== ""],
                        [
                          "Aktiviti PdPC",
                          item.payload.aktiviti.some((a) => a.nama.trim() !== ""),
                        ],
                        ["Refleksi", item.payload.refleksi.trim() !== ""],
                      ] as [string, boolean][]
                    ).map(([label, ok]) => (
                      <div
                        key={label}
                        className="flex justify-between border-b border-dashed border-border py-2 text-[13px] last:border-b-0"
                      >
                        <span className="text-ink-3">{label}</span>
                        <span
                          className="font-bold"
                          style={{
                            color: ok ? "var(--color-success-ink)" : "var(--color-danger-ink)",
                          }}
                        >
                          {ok ? "✓" : "✕"}
                        </span>
                      </div>
                    ))}
                  <div className="mt-3">
                    {score === 100 ? (
                      <Badge variant="success">Semua keperluan dipenuhi</Badge>
                    ) : (
                      <Badge variant="warning">{score}% lengkap</Badge>
                    )}
                  </div>
                </div>

                <div className="mb-3">
                  <Label htmlFor="f-25282">
                    {ms.review.comment}{" "}
                    <span className="font-normal text-ink-4">({ms.review.commentHint})</span>
                  </Label>
                  <Textarea
                    id="f-25282"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Tulis maklum balas untuk guru…"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(
                      [
                        ["+ KBAT", "Aktiviti penutup boleh tambah soalan KBAT."],
                        ["+ Refleksi", "Sila lengkapkan bahagian Refleksi & Intervensi."],
                        ["+ Masa", "Masa aktiviti melebihi 50 minit — sila laraskan."],
                      ] as [string, string][]
                    ).map(([label, text]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setComment((c) => (c ? `${c} ${text}` : text))}
                        className="rounded-full border border-border-strong bg-surface px-2.5 py-1 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-3"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Button
                    size="lg"
                    variant="success"
                    disabled={deciding}
                    onClick={() => decide("sahkan")}
                  >
                    <Check className="h-4 w-4" strokeWidth={2.4} aria-hidden />
                    {ms.review.approve}
                    <kbd className="rounded border border-white/25 bg-white/20 px-1.5 font-mono text-[11px]">
                      1
                    </kbd>
                  </Button>
                  <Button
                    size="lg"
                    variant="danger"
                    disabled={deciding}
                    onClick={() => decide("hantar_balik")}
                  >
                    <Undo2 className="h-4 w-4" strokeWidth={2.1} aria-hidden />
                    {ms.review.return}
                    <kbd className="rounded border border-black/10 bg-black/10 px-1.5 font-mono text-[11px]">
                      0
                    </kbd>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => toast("Draf komen disimpan · teruskan ke RPH seterusnya")}
                  >
                    <MessageSquare className="h-4 w-4" strokeWidth={1.9} aria-hidden />
                    {ms.review.saveAndContinue} →
                  </Button>
                </div>

                <div className="mt-3 flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft p-3 text-[12.5px] leading-[1.55] text-info-ink">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
                  <div>
                    Gred 1/0 selaras <b>Lampiran 7</b> Garis Panduan e-RPH KPM: 1 = lengkap, 0 =
                    tidak lengkap.
                    <br />
                    {ms.review.signedNote}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  tone,
  bar,
}: {
  label: string;
  value: string;
  tone: "ok" | "bad" | "warn";
  bar?: number;
}) {
  const color =
    tone === "ok"
      ? "var(--color-success)"
      : tone === "bad"
        ? "var(--color-danger)"
        : "var(--color-warning)";
  const soft =
    tone === "ok" ? "bg-success-soft" : tone === "bad" ? "bg-danger-soft" : "bg-warning-soft";
  return (
    <Card className="relative overflow-hidden p-4">
      <span
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
        aria-hidden
      />
      <div className="flex items-start justify-between">
        <span className="text-[12.5px] font-semibold text-ink-3">{label}</span>
        <span className={cn("grid h-8 w-8 place-items-center rounded-[9px]", soft)} aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        </span>
      </div>
      <div className="num mt-1.5 text-[28px] leading-none font-extrabold tracking-[-1.2px]">
        {value}
      </div>
      {bar !== undefined && (
        <div className="mt-2 h-1.75 w-full overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-success" style={{ width: `${bar}%` }} />
        </div>
      )}
    </Card>
  );
}
