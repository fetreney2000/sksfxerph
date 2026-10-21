"use client";

import { Check, Info, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { RphPaper } from "@/components/rph/rph-paper";
import { useUser } from "@/components/shell/user-context";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reviewStageFor } from "@/lib/auth/permissions";
import { cn } from "@/lib/cn";
import { supabaseConfigured } from "@/lib/config";
import { longDate } from "@/lib/date";
import type { QueueItem } from "@/lib/demo/review";
import { useReviewQueueData, useSchoolStats } from "@/lib/hooks/use-remote";
import { useSchool } from "@/lib/hooks/use-school";
import { useSession } from "@/lib/hooks/use-session";
import { ms } from "@/lib/i18n/ms";
import { completeness, normalisePayload } from "@/lib/schemas/rph";
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
  const router = useRouter();
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
   * The detail pane is a full-screen dialog on a phone.
   *
   * The split view puts the queue above the document, so the decision buttons
   * used to be a long scroll below a whole printed RPH. Opening a row now
   * shows the plan alone, with the decisions pinned to the bottom.
   */
  const [mobileOpen, setMobileOpen] = React.useState(false);
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
  /** A return must carry a reason: an empty "RPH perlu dibaiki" is not actionable. */
  const canReturn = comment.trim().length > 0;

  const openReview = (id: string) => {
    if (id !== selected) setComment("");
    setSelected(id);
    // Desktop already has the document beside the queue; only the phone needs
    // the dedicated screen.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setMobileOpen(true);
    }
  };

  const visible = React.useMemo(
    () => (filter === "belum" ? QUEUE.filter((q) => !(q.id in graded)) : QUEUE),
    [filter, graded, QUEUE],
  );

  const decide = React.useCallback(
    (decision: ReviewDecision) => {
      if (!item || deciding) return;
      if (decision === "hantar_balik" && !comment.trim()) {
        toast.info(ms.review.returnReasonRequired);
        return;
      }
      setDeciding(true);

      // Server owns the decision when configured: sahkan_rph / hantar_balik_rph
      // write the review, the notification to the teacher and the audit row,
      // and sahkan_rph refuses unless a verified signature is already on file —
      // so an approval here means the browser has signed it first. Local mode
      // updates the demo queue only.
      /**
       * What a *recorded* decision does to the screen.
       *
       * Called only once the write has landed — or in local mode, where the
       * write is the screen. Doing it earlier marked a plan as graded while
       * the toast beside it said the review had failed, and the plan left the
       * queue the reviewer was working through.
       */
      const applyDecision = () => {
        setGraded((g) => ({ ...g, [item.id]: decision === "sahkan" ? 1 : 0 }));
        setComment("");
        // Advance to the next ungraded item — the queue is the whole workflow.
        const next = QUEUE.find((q) => !(q.id in graded) && q.id !== item.id);
        if (next) setSelected(next.id);
        // On a phone the dialog is the workspace. Once the last decision is
        // made, leave it so the reviewer sees the finished queue and toast,
        // rather than the plan they just approved still filling the screen.
        else setMobileOpen(false);
      };

      if (supabaseConfigured) {
        void decideRph({
          userId: meId,
          documentId: item.id,
          version: item.version,
          payload: item.payload,
          decision,
          comment: comment.trim() || undefined,
        })
          .then(() => {
            toast.success(decisionMessage(decision));
            applyDecision();
          })
          .catch((err: unknown) =>
            toast.error(
              `Gagal menyemak: ${err instanceof Error ? err.message : "ralat rangkaian"}`,
            ),
          )
          .finally(() => setDeciding(false));
      } else {
        toast.success(decisionMessage(decision));
        applyDecision();
        setDeciding(false);
      }
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
        if (next) {
          if (next.id !== selected) setComment("");
          setSelected(next.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, visible, selected]);

  return (
    <>
      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          label={ms.review.pending}
          value={String(QUEUE.length - Object.keys(graded).length)}
          tone="warn"
        />
        <Kpi
          label={ms.review.approvedThisSession}
          value={String(Object.values(graded).filter((g) => g === 1).length)}
          tone="ok"
        />
        <Kpi
          label={ms.review.returnedThisSession}
          value={String(Object.values(graded).filter((g) => g === 0).length)}
          tone="bad"
        />
        <Kpi
          label="Pematuhan sekolah"
          // "—" rather than 0% when the school has no denominator or the
          // figure has not been measured.
          value={stats.compliancePct === null ? "—" : `${stats.compliancePct}%`}
          tone="ok"
          bar={stats.compliancePct ?? 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[336px_1fr] items-start">
        {/* ── Queue ──────────────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardHeader className="flex-wrap gap-2.5">
            <CardTitle>{ms.review.queue}</CardTitle>
            <span className="ml-auto hidden items-center gap-1.5 lg:flex">
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
            <p className="mt-2 text-[11.5px] text-ink-4 lg:hidden">{ms.review.tapHint}</p>
            <div className="mt-2.5 hidden items-center gap-2 text-[11.5px] text-ink-4 lg:flex">
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

          <div className="overflow-y-auto lg:max-h-[560px]">
            {visible.map((q) => {
              const g = graded[q.id];
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => openReview(q.id)}
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

        {/* ── Document + decision (desktop split view) ───────────────────── */}
        {item && (
          <Card className="hidden lg:block">
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => router.push(`/editor/${item.id}`)}
                >
                  Buka penuh
                </Button>
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <ReviewWorkspace
                item={item}
                mode="desktop"
                session={session}
                schoolName={school.name}
                comment={comment}
                onComment={setComment}
                canReturn={canReturn}
                deciding={deciding}
                onDecide={decide}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Document + decision (phone) ────────────────────────────────────
          The queue, the whole printed plan and the decision buttons used to be
          one vertical scroll. The plan now gets its own full-screen surface,
          and the two decisions sit in a bar that never leaves the viewport. */}
      {item && (
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogContent className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 p-0">
            <DialogHeader className="shrink-0 border-b border-border pr-12 pb-3">
              <div className="flex items-start gap-3">
                <DialogTitle className="min-w-0 flex-1 truncate text-[15px]">
                  {item.teacherName} · {item.className}
                </DialogTitle>
                <Button asChild size="sm" variant="ghost" className="shrink-0">
                  <Link href={`/editor/${item.id}`}>Buka penuh</Link>
                </Button>
              </div>
              <DialogDescription className="mt-0.5">
                {item.subjectName} ·{" "}
                <span className="num">
                  {longDate(item.planDate)} · {item.slotTime}
                </span>
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <ReviewWorkspace
                item={item}
                mode="mobile"
                session={session}
                schoolName={school.name}
                comment={comment}
                onComment={setComment}
                canReturn={canReturn}
                deciding={deciding}
                onDecide={decide}
              />
            </div>

            <div className="shrink-0 border-t border-border bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <DecisionBar canReturn={canReturn} deciding={deciding} onDecide={decide} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/**
 * The document, auto-check and comment box.
 *
 * Shared by the desktop card and the phone dialog so a field added to the
 * review checklist cannot appear in one layout and be missing from the other.
 * The decisions themselves are separate: the desktop stacks them under the
 * comment, while the phone keeps them in `DecisionBar` outside the scroll.
 */
function ReviewWorkspace({
  item,
  mode,
  session,
  schoolName,
  comment,
  onComment,
  canReturn,
  deciding,
  onDecide,
}: {
  item: QueueItem;
  mode: "desktop" | "mobile";
  session: string;
  schoolName: string;
  comment: string;
  onComment: (value: string) => void;
  canReturn: boolean;
  deciding: boolean;
  onDecide: (decision: ReviewDecision) => void;
}) {
  const desktop = mode === "desktop";

  return (
    <div className={cn("grid gap-4", desktop ? "p-4.5 xl:grid-cols-[1fr_300px]" : "p-4")}>
      <RphPaper
        payload={item.payload}
        className={desktop ? undefined : "p-4"}
        compact={!desktop}
        session={session}
        schoolName={schoolName}
        teacherName={item.teacherName}
        planClassName={item.className}
        subjectName={item.subjectName}
        planDate={item.planDate}
        slotTime={item.slotTime}
      />

      <div>
        <AutoCheck item={item} />
        <CommentBox comment={comment} onComment={onComment} />
        {desktop && (
          <>
            <DecisionButtons canReturn={canReturn} deciding={deciding} onDecide={onDecide} />
            <InfoNote />
          </>
        )}
      </div>
    </div>
  );
}

function AutoCheck({ item }: { item: QueueItem }) {
  // Queue rows arrive straight off the wire, so a plan written before the
  // template reshape has no `kriteria_kejayaan`. Normalise once here rather
  // than guarding six separate field reads.
  const p = normalisePayload(item.payload);
  const score = completeness(item.payload);
  const rows: [string, boolean][] = [
    ["Standard Kandungan", p.standard_kandungan.trim() !== ""],
    ["Standard Pembelajaran", p.standard_pembelajaran.trim() !== ""],
    ["Objektif", p.objektif.trim() !== ""],
    ["Kriteria Kejayaan", p.kriteria_kejayaan.trim() !== ""],
    ["Aktiviti PdPC", p.aktiviti.some((a) => a.nama.trim() !== "")],
    ["Refleksi", p.refleksi.trim() !== ""],
  ];

  return (
    // Mirrors the checklist `sahkan_rph()` stores — exactly the six rows the
    // printed form cannot be issued without, not the editor's step grouping.
    <div className="mb-3 rounded-[11px] border border-border bg-surface-2 p-3.5">
      <p className="mb-2.5 text-[11px] font-bold tracking-[0.7px] text-ink-4 uppercase">
        {ms.review.autoCheck}
      </p>
      {rows.map(([label, ok]) => (
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
  );
}

function CommentBox({
  comment,
  onComment,
}: {
  comment: string;
  onComment: (value: string) => void;
}) {
  // `useId` because the desktop card and the phone dialog can both be in the
  // DOM at once; a hardcoded id would point the second label at the first box.
  const id = React.useId();

  return (
    <div className="mb-3">
      <Label htmlFor={id}>
        {ms.review.comment}{" "}
        <span className="font-normal text-ink-4">({ms.review.commentHint})</span>
      </Label>
      <Textarea
        id={id}
        value={comment}
        onChange={(e) => onComment(e.target.value)}
        placeholder="Tulis maklum balas untuk guru…"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(
          [
            ["+ KBAT", "Aktiviti penutup boleh tambah soalan KBAT."],
            ["+ Refleksi", "Sila lengkapkan bahagian Refleksi."],
            ["+ Masa", "Masa aktiviti melebihi 50 minit — sila laraskan."],
          ] as [string, string][]
        ).map(([label, text]) => (
          <button
            key={label}
            type="button"
            onClick={() => onComment(comment ? `${comment} ${text}` : text)}
            className="rounded-full border border-border-strong bg-surface px-2.5 py-1 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-3"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DecisionButtons({
  canReturn,
  deciding,
  onDecide,
}: {
  canReturn: boolean;
  deciding: boolean;
  onDecide: (decision: ReviewDecision) => void;
}) {
  const hintId = React.useId();

  return (
    <div>
      <div className="grid gap-2">
        <Button
          size="lg"
          variant="success"
          disabled={deciding}
          onClick={() => onDecide("sahkan")}
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
          disabled={deciding || !canReturn}
          aria-describedby={!canReturn ? hintId : undefined}
          title={!canReturn ? ms.review.returnReasonRequired : undefined}
          onClick={() => onDecide("hantar_balik")}
        >
          <Undo2 className="h-4 w-4" strokeWidth={2.1} aria-hidden />
          {ms.review.return}
          <kbd className="rounded border border-black/10 bg-black/10 px-1.5 font-mono text-[11px]">
            0
          </kbd>
        </Button>
        {/* No "Simpan & teruskan". It claimed to save a comment draft and the
            app has nowhere to keep one — no draft table, no local store — so
            pressing it changed nothing. Both real actions above take the typed
            comment with the decision. */}
      </div>
      {!canReturn && (
        <p id={hintId} className="mt-1.5 text-center text-[11.5px] leading-[1.4] text-ink-4">
          {ms.review.returnReasonRequired}
        </p>
      )}
    </div>
  );
}

/** The phone's decision bar: outside the scroll, so both choices stay visible. */
function DecisionBar({
  canReturn,
  deciding,
  onDecide,
}: {
  canReturn: boolean;
  deciding: boolean;
  onDecide: (decision: ReviewDecision) => void;
}) {
  const hintId = React.useId();

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5">
        <Button
          size="lg"
          variant="success"
          disabled={deciding}
          onClick={() => onDecide("sahkan")}
          className="min-w-0"
        >
          <Check className="h-4 w-4 shrink-0" strokeWidth={2.4} aria-hidden />
          <span className="truncate">{ms.review.approveShort}</span>
        </Button>
        <Button
          size="lg"
          variant="danger"
          disabled={deciding || !canReturn}
          aria-describedby={!canReturn ? hintId : undefined}
          title={!canReturn ? ms.review.returnReasonRequired : undefined}
          onClick={() => onDecide("hantar_balik")}
          className="min-w-0"
        >
          <Undo2 className="h-4 w-4 shrink-0" strokeWidth={2.1} aria-hidden />
          <span className="truncate">{ms.review.returnShort}</span>
        </Button>
      </div>
      {!canReturn && (
        <p id={hintId} className="mt-1.5 text-center text-[11.5px] leading-[1.4] text-ink-4">
          {ms.review.returnReasonRequired}
        </p>
      )}
    </div>
  );
}

function InfoNote() {
  return (
    <div className="mt-3 flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft p-3 text-[12.5px] leading-[1.55] text-info-ink">
      <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
      <div>
        Gred 1/0 selaras <b>Lampiran 7</b> Garis Panduan e-RPH KPM: 1 = lengkap, 0 = tidak
        lengkap.
        <br />
        {ms.review.signedNote}
      </div>
    </div>
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
    <Card className="relative overflow-hidden p-3 sm:p-4">
      <span
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] leading-tight font-semibold text-ink-3 sm:text-[12.5px]">
          {label}
        </span>
        <span
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-[8px] sm:h-8 sm:w-8 sm:rounded-[9px]",
            soft,
          )}
          aria-hidden
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        </span>
      </div>
      <div className="num mt-1.5 text-[24px] leading-none font-extrabold tracking-[-1px] sm:text-[28px] sm:tracking-[-1.2px]">
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
