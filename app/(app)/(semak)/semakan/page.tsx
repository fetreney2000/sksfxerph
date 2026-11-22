"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  Info,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { RphPaper } from "@/components/rph/rph-paper";
import { StatusBadge } from "@/components/rph/status-badge";
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
import { handleExpiredSession } from "@/lib/client/auth-session";
import { cn } from "@/lib/cn";
import { supabaseConfigured } from "@/lib/config";
import { longDate, longDateOf, schoolDays, weekRangeLabel } from "@/lib/date";
import type { QueueItem } from "@/lib/demo/review";
import type { ReviewPlanLight } from "@/lib/hooks/use-remote";
import { useReviewPlans, useReviewQueueData, useSchoolStats } from "@/lib/hooks/use-remote";
import { useSchool } from "@/lib/hooks/use-school";
import { useSession } from "@/lib/hooks/use-session";
import { ms } from "@/lib/i18n/ms";
import { isPastReviewWeek } from "@/lib/review-week";
import { RpcError, submitRph } from "@/lib/rpc";
import { completeness, normalisePayload } from "@/lib/schemas/rph";
import { decide as decideRph, type ReviewDecision } from "@/lib/signature/review";
import type { RphStatus } from "@/lib/types";

/**
 * Review queue - the admin screen.
 *
 * Keyboard-first on purpose: a GPK grades 40–60 plans a week, so `J`/`K` to
 * move and `1`/`0` to decide (the exact grades from Lampiran 7 of the KPM
 * Garis Panduan) is the difference between a 5-minute job and a 30-minute one.
 */
/** The message shown after a decision. Both reviewers now end the flow. */
function decisionMessage(decision: ReviewDecision): string {
  if (decision === "hantar_balik") return "Tidak lengkap - dikembalikan kepada guru";
  return "Disahkan dan ditandatangani - guru dimaklumkan";
}

/**
 * What a browsed row lets the reviewer actually do.
 *
 * A `draft` is actionable through the submit-on-behalf step (the server's
 * `submit_rph` already permits staff to submit for their teachers), a
 * `submitted` plan is the ordinary decision, and everything else - approved,
 * returned, forwarded - is listed only so the week reads as a whole. Re-deciding
 * an audited plan would fork the audit trail, so it is view-only here.
 */
function isActionable(q: { status: RphStatus }): boolean {
  return q.status === "draft" || q.status === "submitted";
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("");
}

export default function SemakanPage() {
  // Remote when configured, bundled demo otherwise - same shape either way.
  const { id: meId, role } = useUser();
  const queryClient = useQueryClient();
  const session = useSession();
  const school = useSchool();
  const stage = reviewStageFor(role);
  const {
    items: QUEUE,
    total: queueTotal,
    hasMore,
    loadingMore,
    loadMore,
  } = useReviewQueueData(stage?.status ?? null);
  const {
    items: plans,
    loading: plansLoading,
    assigned,
    refetch: refetchPlans,
  } = useReviewPlans();
  const stats = useSchoolStats();
  const [selected, setSelected] = React.useState<string | undefined>(QUEUE[0]?.id);
  const [graded, setGraded] = React.useState<Record<string, 0 | 1>>({});
  const [comment, setComment] = React.useState("");
  const [filter, setFilter] = React.useState<"belum" | "semua">("belum");

  // ── Tree ─────────────────────────────────────────────────────────────────
  // Tahun → Guru → Minggu → Senarai. Sessions newest first; teachers by
  // pending load, then name; weeks newest first. The pending queue stays a
  // first-class node on top - it is the work list, the tree is the archive.
  const tree = React.useMemo(() => {
    const bySession = new Map<string, ReviewPlanLight[]>();
    for (const p of plans) {
      const list = bySession.get(p.session) ?? [];
      list.push(p);
      bySession.set(p.session, list);
    }
    return [...bySession.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .map(([s, rows]) => {
        const byTeacher = new Map<string, ReviewPlanLight[]>();
        for (const p of rows) {
          const list = byTeacher.get(p.teacherId) ?? [];
          list.push(p);
          byTeacher.set(p.teacherId, list);
        }
        const teachers = [...byTeacher.entries()]
          .map(([teacherId, trows]) => {
            const byWeek = new Map<number, ReviewPlanLight[]>();
            for (const p of trows) {
              const list = byWeek.get(p.weekNo) ?? [];
              list.push(p);
              byWeek.set(p.weekNo, list);
            }
            const weeks = [...byWeek.entries()].sort((a, b) => b[0] - a[0]);
            const pending = trows.filter((p) => p.status === "submitted").length;
            return {
              teacherId,
              teacherName: trows[0]?.teacherName ?? "Guru",
              total: trows.length,
              pending,
              weeks,
            };
          })
          .sort((a, b) => b.pending - a.pending || a.teacherName.localeCompare(b.teacherName));
        return { session: s, total: rows.length, teachers };
      });
  }, [plans]);

  const [open, setOpen] = React.useState<Set<string> | null>(null);
  const toggle = (key: string) => {
    const base = open ?? new Set(["pending", ...(tree[0] ? [`s:${tree[0].session}`] : [])]);
    const next = new Set(base);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };
  const isOpen = (key: string) =>
    open !== null
      ? open.has(key)
      : key === "pending" || (tree[0] ? key === `s:${tree[0].session}` : false);

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
   * Without it, a second click on "Sahkan" signs and posts again - and before
   * the server-side fix, the loser of that race reported a 500 for an approval
   * that had in fact gone through. The queue advances optimistically, so this
   * only re-enables the buttons once the first request has actually settled.
   */
  const [deciding, setDeciding] = React.useState(false);

  // The pending work list, honouring the Belum/Semua tabs. `graded` is local:
  // a decision already recorded stays recorded for this sitting.
  const pendingVisible = React.useMemo(
    () => (filter === "belum" ? QUEUE.filter((q) => !(q.id in graded)) : QUEUE),
    [filter, graded, QUEUE],
  );

  // Selection must follow the data: the queue resolves asynchronously in
  // synced mode, so a value captured at first render can be stale.
  React.useEffect(() => {
    if (!selected && pendingVisible.length > 0) setSelected(pendingVisible[0]?.id);
  }, [pendingVisible, selected]);

  // A plan opened from the tree carries no body - the tree rows are light -
  // so the full row is fetched for the detail pane. Pending rows already hold
  // theirs, exactly as the queue always did.
  const selectedPending = QUEUE.find((q) => q.id === selected);
  const needFetch = selected !== undefined && !selectedPending;
  const planQuery = useQuery({
    queryKey: ["review-plan", selected],
    queryFn: async (): Promise<QueueItem | null> => {
      const res = await fetch(`/api/rph/${encodeURIComponent(selected ?? "")}`, {
        credentials: "same-origin",
      });
      if (handleExpiredSession(res.status)) return null;
      if (!res.ok) return null;
      const body = (await res.json()) as {
        item?: {
          id: string;
          version: number;
          class_names?: string[];
          subject?: { nama: string } | null;
          subject_code: string;
          session: string;
          plan_date: string;
          slot_time: string | null;
          status: RphStatus;
          payload: unknown;
          rph_review?: {
            reviewer?: { full_name: string } | null;
            comment: string | null;
            created_at: string;
            grade: 0 | 1;
          }[];
        };
        teacherName?: string;
      };
      const row = body.item;
      if (!row) return null;
      const teacherName = body.teacherName ?? "Guru";
      return {
        id: row.id,
        version: row.version,
        teacherName,
        initials: initialsOf(teacherName),
        tone: "blue",
        className: (row.class_names ?? []).filter(Boolean).join(", ") || "-",
        subjectName: row.subject?.nama ?? row.subject_code,
        planDate: row.plan_date,
        slotTime: row.slot_time ?? "07:30",
        status: row.status,
        ageLabel: "",
        payload: row.payload as QueueItem["payload"],
        session: row.session,
        reviews: [...(row.rph_review ?? [])]
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .map((review) => ({
            reviewerName: review.reviewer?.full_name ?? null,
            comment: review.comment,
            createdAt: review.created_at,
            grade: review.grade,
          })),
      };
    },
    enabled: supabaseConfigured && needFetch,
    retry: false,
    staleTime: 30_000,
  });

  const item: QueueItem | null | undefined = selectedPending ?? planQuery.data ?? null;
  const detailLoading = needFetch && planQuery.isLoading;

  // The leaf list the keyboard walks and decisions advance through: the
  // pending list, or the week the selected plan belongs to.
  const activeLeaves: { id: string; status: RphStatus }[] = React.useMemo(() => {
    if (!selected || selectedPending) return pendingVisible;
    const found = plans.find((p) => p.id === selected);
    if (!found) return pendingVisible;
    return plans.filter(
      (p) =>
        p.teacherId === found.teacherId &&
        p.weekNo === found.weekNo &&
        p.session === found.session,
    );
  }, [selected, selectedPending, pendingVisible, plans]);

  /** A return must carry a reason: an empty "RPH perlu dibaiki" is not actionable. */
  const canReturn = comment.trim().length > 0;
  /**
   * Tree selections are browse mode: a decided plan is view-only there, the
   * way the old week browser was. Pending selections are the queue, decidable
   * by definition.
   */
  const fromTree = selected !== undefined && !selectedPending;
  /**
   * A locally-graded queue row is decided too, wherever the tab lists it.
   *
   * The queue row keeps the `submitted` status it was fetched with - a
   * decision updates `graded`, not the row - so without this, re-opening the
   * plan from the Semua tab offered active Sahkan/Kembalikan buttons for a
   * decision that had already been recorded, and pressing one only died at
   * the server RPC.
   */
  const gradedSelected = selectedPending ? graded[selectedPending.id] : undefined;
  const readOnly =
    (fromTree && item !== undefined && item !== null && !isActionable(item)) ||
    (item != null && !isPastReviewWeek(item.planDate)) ||
    gradedSelected !== undefined;
  /** The explanatory note for a row the reviewer cannot (yet) decide. */
  const itemNote = item
    ? !isPastReviewWeek(item.planDate)
      ? "RPH hanya boleh disemak selepas minggu tersebut tamat."
      : readOnly
        ? ms.review.decidedNote
        : item.status === "draft"
          ? ms.review.draftNote
          : undefined
    : undefined;

  const openReview = (id: string) => {
    if (id !== selected) setComment("");
    setSelected(id);
    // Desktop already has the document beside the queue; only the phone needs
    // the dedicated screen.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setMobileOpen(true);
    }
  };

  const decide = React.useCallback(
    (decision: ReviewDecision) => {
      if (!item || deciding) return;
      // A decided plan (browse mode, or graded earlier this sitting) is
      // view-only: re-deciding it would fork what the audit trail already
      // recorded.
      if (!isActionable(item) || !isPastReviewWeek(item.planDate) || item.id in graded) return;
      if (decision === "hantar_balik" && !comment.trim()) {
        toast.info(ms.review.returnReasonRequired);
        return;
      }
      setDeciding(true);

      // Server owns the decision when configured: sahkan_rph / hantar_balik_rph
      // write the review, the notification to the teacher and the audit row,
      // and sahkan_rph refuses unless a verified signature is already on file -
      // so an approval here means the browser has signed it first. Local mode
      // updates the demo queue only.
      /**
       * What a *recorded* decision does to the screen.
       *
       * Called only once the write has landed - or in local mode, where the
       * write is the screen. Doing it earlier marked a plan as graded while the
       * toast beside it said the review had failed, and the plan left the
       * queue the reviewer was working through.
       */
      const applyDecision = () => {
        setGraded((g) => ({ ...g, [item.id]: decision === "sahkan" ? 1 : 0 }));
        setComment("");
        // Advance to the next actionable, ungraded item in the list being
        // worked - the reviewer's place, not the top of something else.
        const next = activeLeaves.find(
          (q) => isActionable(q) && !(q.id in graded) && q.id !== item.id,
        );
        if (next) setSelected(next.id);
        // On a phone the dialog is the workspace. Once the last decision is
        // made, leave it so the reviewer sees the finished queue and toast,
        // rather than the plan they just approved still filling the screen.
        else setMobileOpen(false);
        // A browsed plan changed status in place, so the tree must re-read
        // the server to show it - the local copy still says what it said.
        if (fromTree) {
          void refetchPlans();
          void queryClient.invalidateQueries({ queryKey: ["review-plan", item.id] });
        }
        // The badge and the "Muat lagi" count come from the server's exact
        // total, not from the rows this page happened to load.
        void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      };

      if (supabaseConfigured) {
        void (async () => {
          try {
            // A draft must be submitted before the decide RPCs will touch it -
            // they only answer a `submitted` plan. `submit_rph` lets staff
            // submit on the teacher's behalf, and it bumps the document
            // version, so the signature envelope has to be built over the
            // version the submit *returned*, not the one the queue row had.
            let version = item.version;
            if (item.status === "draft") {
              const verdict = await submitRph(item.id);
              if (verdict && !verdict.ok) {
                // e.g. the school requires 100% completeness and this draft
                // falls short: the server's word is final, and "hantar"
                // (`force`) is the *teacher's* acknowledged escape hatch, not
                // something a reviewer presses for them.
                toast.error(verdict.error ?? "RPH tidak dapat dihantar.");
                setDeciding(false);
                return;
              }
              if (typeof verdict?.version === "number") version = verdict.version;
              toast.success(ms.review.submitFirst);
            }
            await decideRph({
              userId: meId,
              documentId: item.id,
              version,
              payload: item.payload,
              decision,
              comment: comment.trim() || undefined,
            });
            toast.success(decisionMessage(decision));
            applyDecision();
          } catch (err) {
            // An expired session is NOT a review failure: claiming "Diputuskan"
            // while the server never saw it would be a lie. Send them to re-auth.
            if (err instanceof RpcError && err.isAuthFailure) {
              toast.error("Sesi anda telah tamat. Sila log masuk semula.");
              window.setTimeout(() => window.location.assign("/login"), 1200);
              return;
            }
            // A failed decision leaves stale rows behind: the teacher may have
            // saved since this screen loaded, in which case the signature just
            // bound the wrong version. Re-read everything, so the retry the
            // reviewer is about to press works on the current row instead of
            // failing the same way.
            void refetchPlans();
            void queryClient.invalidateQueries({ queryKey: ["review-plan", item.id] });
            void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
            const message = err instanceof Error ? err.message : "ralat rangkaian";
            if (/versi/i.test(message)) {
              toast.error(
                "RPH telah dikemas kini guru. Data disegar semula - cuba sekali lagi.",
              );
            } else {
              toast.error(`Gagal menyemak: ${message}`);
            }
          } finally {
            setDeciding(false);
          }
        })();
      } else {
        // Local mode: there is no server to submit to, so a draft is decided
        // on the demo data directly.
        toast.success(decisionMessage(decision));
        applyDecision();
        setDeciding(false);
      }
    },
    [item, deciding, graded, comment, activeLeaves, meId, fromTree, refetchPlans, queryClient],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "1") decide("sahkan");
      if (e.key === "0") decide("hantar_balik");
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const idx = activeLeaves.findIndex((q) => q.id === selected);
        const delta = e.key === "j" ? 1 : -1;
        const next = activeLeaves[Math.max(0, Math.min(activeLeaves.length - 1, idx + delta))];
        if (next) {
          if (next.id !== selected) setComment("");
          setSelected(next.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, activeLeaves, selected]);

  // ── Tree rows ────────────────────────────────────────────────────────────
  // One button shape for every leaf, pending or browsed: first name and class
  // on top, subject and date below. The right-hand badge answers a different
  // question per node - pending rows show the local grading state, tree rows
  // the plan's own status.
  const leafCls = (active: boolean) =>
    cn(
      "flex w-full gap-2.5 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0",
      active
        ? "bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)]"
        : "hover:bg-surface-2",
    );

  const pendingCount =
    QUEUE.filter((q) => !(q.id in graded)).length + Math.max(0, queueTotal - QUEUE.length);

  return (
    <>
      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi label={ms.review.pending} value={String(pendingCount)} tone="warn" />
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
          // "-" rather than 0% when the school has no denominator or the
          // figure has not been measured.
          value={stats.compliancePct === null ? "-" : `${stats.compliancePct}%`}
          tone="ok"
          bar={stats.compliancePct ?? 0}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[336px_1fr]">
        {/* ── Tree ───────────────────────────────────────────────────────── */}
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
            <p className="text-[11.5px] text-ink-4 lg:hidden">{ms.review.tapHint}</p>
            <div className="mt-2 hidden items-center gap-2 text-[11.5px] text-ink-4 lg:flex">
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
            {!assigned ? (
              <p className="px-4 py-10 text-center text-[12.5px] text-ink-4">
                {ms.review.noSupervised}
              </p>
            ) : plansLoading ? (
              <p className="px-4 py-10 text-center text-[12.5px] text-ink-4">Memuatkan…</p>
            ) : (
              <>
                {/* Pending work list - the queue, newest first. */}
                <div>
                  <button
                    type="button"
                    onClick={() => toggle("pending")}
                    aria-expanded={isOpen("pending")}
                    aria-label={`Menunggu semakan, ${pendingCount} RPH`}
                    className="flex w-full items-center gap-2 border-b border-border bg-surface-2/50 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform duration-200",
                        isOpen("pending") && "rotate-90",
                      )}
                      aria-hidden
                    />
                    <Inbox
                      className="h-4 w-4 shrink-0 text-warning-ink"
                      strokeWidth={1.9}
                      aria-hidden
                    />
                    <span className="text-[13px] font-bold">Menunggu semakan</span>
                    <span className="num ml-auto rounded-full border border-warning-line bg-warning-soft px-2 py-px text-[11.5px] font-bold text-warning-ink">
                      {pendingCount}
                    </span>
                  </button>
                  {isOpen("pending") && (
                    <div>
                      <div className="border-b border-border px-4 py-2.5">
                        <Tabs
                          value={filter}
                          onValueChange={(v) => setFilter(v as "belum" | "semua")}
                        >
                          <TabsList>
                            <TabsTrigger value="belum">
                              {ms.review.pending} ({pendingCount})
                            </TabsTrigger>
                            <TabsTrigger value="semua">
                              {ms.review.all} ({queueTotal})
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>
                      <p className="border-b border-border px-4 py-2 text-[11px] leading-[1.4] text-ink-4">
                        Minggu semasa masuk senarai selepas minggu tamat; RPH sesi terdahulu
                        kekal di sini.
                      </p>
                      {pendingVisible.map((q) => {
                        const g = graded[q.id];
                        return (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => openReview(q.id)}
                            className={leafCls(selected === q.id)}
                          >
                            <Avatar initials={q.initials} tone={q.tone} small />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13.5px] font-semibold">
                                {q.teacherName.split(" ")[0]} · {q.className}
                              </span>
                              <span className="block text-[11.5px] text-ink-3">
                                {q.subjectName} · {longDate(q.planDate)}
                              </span>
                              <span className="block text-[11.5px] text-ink-4">
                                {q.ageLabel}
                                {q.session && q.session !== session
                                  ? ` · Sesi ${q.session}`
                                  : ""}
                              </span>
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
                      {hasMore && (
                        <div className="border-t border-border p-3">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full"
                            disabled={loadingMore}
                            onClick={loadMore}
                          >
                            {loadingMore
                              ? "Memuatkan…"
                              : `Muat lagi (${Math.max(0, queueTotal - QUEUE.length)} RPH)`}
                          </Button>
                        </div>
                      )}
                      {pendingVisible.length === 0 && !hasMore && (
                        <p className="px-4 py-10 text-center text-[13px] text-ink-4">
                          Semua RPH sudah disemak. 👍
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Tahun → Guru → Minggu → Senarai */}
                {tree.map((s) => {
                  const sKey = `s:${s.session}`;
                  const sOpen = isOpen(sKey);
                  return (
                    <div key={s.session} className="border-t border-border">
                      <button
                        type="button"
                        onClick={() => toggle(sKey)}
                        aria-expanded={sOpen}
                        aria-label={`Sesi ${s.session}, ${s.total} RPH`}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform duration-200",
                            sOpen && "rotate-90",
                          )}
                          aria-hidden
                        />
                        {sOpen ? (
                          <FolderOpen
                            className="h-4 w-4 shrink-0 text-warning-ink"
                            strokeWidth={1.9}
                            aria-hidden
                          />
                        ) : (
                          <Folder
                            className="h-4 w-4 shrink-0 text-warning-ink"
                            strokeWidth={1.9}
                            aria-hidden
                          />
                        )}
                        <span className="text-[13px] font-bold">Sesi {s.session}</span>
                        <span className="num ml-auto rounded-full border border-border bg-surface-2 px-2 py-px text-[11px] font-semibold text-ink-3">
                          {s.total}
                        </span>
                      </button>

                      {sOpen && (
                        <div className="pb-1">
                          {s.teachers.map((t) => {
                            const tKey = `t:${s.session}:${t.teacherId}`;
                            const tOpen = isOpen(tKey);
                            return (
                              <div
                                key={t.teacherId}
                                className="ml-3 border-l border-border pl-1"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggle(tKey)}
                                  aria-expanded={tOpen}
                                  aria-label={`${t.teacherName}, ${t.pending} menunggu, ${t.total} RPH`}
                                  className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-surface-2"
                                >
                                  <ChevronRight
                                    className={cn(
                                      "h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform duration-200",
                                      tOpen && "rotate-90",
                                    )}
                                    aria-hidden
                                  />
                                  <Avatar
                                    initials={initialsOf(t.teacherName)}
                                    tone="blue"
                                    small
                                  />
                                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                                    {t.teacherName}
                                  </span>
                                  {t.pending > 0 && (
                                    <span className="num shrink-0 rounded-full border border-warning-line bg-warning-soft px-2 py-px text-[11px] font-bold text-warning-ink">
                                      {t.pending}
                                    </span>
                                  )}
                                  <span className="num shrink-0 pr-1 text-[11px] text-ink-4">
                                    {t.total}
                                  </span>
                                </button>

                                {tOpen && (
                                  <div className="ml-4 border-l border-border pl-1">
                                    {t.weeks.map(([weekNo, wplans]) => {
                                      const wKey = `w:${s.session}:${t.teacherId}:${weekNo}`;
                                      const wOpen = isOpen(wKey);
                                      const waiting = wplans.filter(
                                        (p) => p.status === "submitted",
                                      ).length;
                                      const range = schoolDays(weekNo);
                                      return (
                                        <div key={weekNo}>
                                          <button
                                            type="button"
                                            onClick={() => toggle(wKey)}
                                            aria-expanded={wOpen}
                                            aria-label={`Minggu ${weekNo}, ${wplans.length} RPH`}
                                            className="flex w-full items-center gap-1.5 rounded-[8px] px-2 py-[7px] text-left transition-colors hover:bg-surface-2"
                                          >
                                            <ChevronRight
                                              className={cn(
                                                "h-3 w-3 shrink-0 text-ink-4 transition-transform duration-200",
                                                wOpen && "rotate-90",
                                              )}
                                              aria-hidden
                                            />
                                            <CalendarDays
                                              className="h-3.5 w-3.5 shrink-0 text-primary-ink"
                                              strokeWidth={1.9}
                                              aria-hidden
                                            />
                                            <span className="num shrink-0 text-[12.5px] font-bold">
                                              Minggu {weekNo}
                                            </span>
                                            {range[0] && (
                                              <span className="num hidden truncate text-[10.5px] text-ink-4 xl:block">
                                                {weekRangeLabel(weekNo)}
                                              </span>
                                            )}
                                            <span className="num ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-ink-4">
                                              {waiting > 0 && (
                                                <span
                                                  className="h-1.5 w-1.5 rounded-full bg-warning"
                                                  aria-hidden
                                                />
                                              )}
                                              {wplans.length}
                                            </span>
                                          </button>

                                          {wOpen && (
                                            <div className="ml-3 border-l border-border pl-1">
                                              {wplans.map((p) => (
                                                <button
                                                  key={p.id}
                                                  type="button"
                                                  onClick={() => openReview(p.id)}
                                                  className={leafCls(selected === p.id)}
                                                >
                                                  <FileText
                                                    className="mt-0.5 h-4 w-4 shrink-0 text-ink-4"
                                                    strokeWidth={1.9}
                                                    aria-hidden
                                                  />
                                                  <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-[13px] font-semibold">
                                                      {p.teacherName.split(" ")[0]} ·{" "}
                                                      {p.className}
                                                    </span>
                                                    <span className="block truncate text-[11.5px] text-ink-3">
                                                      {p.subjectName} · {longDate(p.planDate)}
                                                    </span>
                                                  </span>
                                                  <StatusBadge status={p.status} />
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </Card>

        {/* ── Document + decision (desktop) ──────────────────────────────── */}
        {detailLoading ? (
          <Card className="hidden lg:block">
            <CardContent className="py-12 text-center text-ink-4">Memuatkan…</CardContent>
          </Card>
        ) : (
          item && (
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
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/semakan/${item.id}`}>Buka penuh</Link>
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
                  readOnly={readOnly}
                  note={itemNote}
                />
              </CardContent>
            </Card>
          )
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
                  <Link href={`/semakan/${item.id}`}>Buka penuh</Link>
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
                readOnly={readOnly}
                note={itemNote}
              />
            </div>

            <div className="shrink-0 border-t border-border bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {readOnly ? (
                <ViewOnlyNote text={itemNote ?? ms.review.decidedNote} tone="muted" />
              ) : (
                <>
                  {itemNote && <ViewOnlyNote text={itemNote} tone="info" className="mb-2.5" />}
                  <DecisionBar canReturn={canReturn} deciding={deciding} onDecide={decide} />
                </>
              )}
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
 * comment, while the phone keeps them in a `DecisionBar` outside the scroll.
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
  readOnly = false,
  note,
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
  /** Browse mode: a decided plan renders without the decision controls. */
  readOnly?: boolean;
  /** Why the row is not (yet) decidable - the draft or decided note. */
  note?: string;
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
        <ReviewHistory item={item} />
        <AutoCheck item={item} />
        {readOnly ? (
          // A decided plan: no comment box (there is nothing to comment into),
          // no decisions - the note says why the row is closed.
          desktop && note ? (
            <ViewOnlyNote text={note} tone="muted" />
          ) : null
        ) : (
          <>
            <CommentBox comment={comment} onComment={onComment} />
            {desktop && (
              <>
                <DecisionButtons
                  canReturn={canReturn}
                  deciding={deciding}
                  onDecide={onDecide}
                />
                {note ? <ViewOnlyNote text={note} tone="info" /> : null}
                <InfoNote />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What happened to this plan before the current submission.
 *
 * A returned plan can come back weeks later with changes; the reviewer needs
 * the reason they sent it back, not only the plan's present content. The queue
 * embeds `rph_review`, so this costs no extra request for a pending row.
 */
function ReviewHistory({ item }: { item: QueueItem }) {
  const notes = item.reviews ?? [];
  if (notes.length === 0) return null;

  return (
    <div className="mb-3 rounded-[11px] border border-border bg-surface-2 p-3.5">
      <p className="mb-2.5 text-[11px] font-bold tracking-[0.7px] text-ink-4 uppercase">
        Sejarah semakan
      </p>
      <div className="max-h-56 space-y-2.5 overflow-y-auto pr-1">
        {notes.map((note) => (
          <div
            key={`${note.createdAt}-${note.reviewerName ?? "penyemak"}-${note.grade}`}
            className="border-b border-dashed border-border pb-2.5 last:border-b-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[12.5px] font-semibold text-ink">
                {note.reviewerName ?? "Penyemak"}
              </span>
              <span className="text-[11px] text-ink-4">{longDateOf(note.createdAt)}</span>
              <Badge
                variant={note.grade === 1 ? "success" : "danger"}
                className="ml-auto shrink-0"
              >
                {note.grade === 1 ? "Lengkap" : "Dikembalikan"}
              </Badge>
            </div>
            {note.comment?.trim() && (
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-[1.5] text-ink-3">
                {note.comment}
              </p>
            )}
          </div>
        ))}
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
    // Mirrors the checklist `sahkan_rph()` stores - exactly the six rows the
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
      <Textarea id={id} value={comment} onChange={(e) => onComment(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(
          [
            ["+ KBAT", "Aktiviti penutup boleh tambah soalan KBAT."],
            ["+ Refleksi", "Sila lengkapkan bahagian Refleksi."],
            ["+ Masa", "Masa aktiviti melebihi 50 minit - sila laraskan."],
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
            app has nowhere to keep one - no draft table, no local store - so
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

/**
 * Why a browsed row is not (yet) decidable, or what deciding a draft will do.
 *
 * `info` marks an *actionable* row with an extra step (the draft note); `muted`
 * marks a closed one (the decided note) - the two read differently on purpose.
 */
function ViewOnlyNote({
  text,
  tone,
  className,
}: {
  text: string;
  tone: "info" | "muted";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-[10px] p-3 text-[12.5px] leading-[1.55]",
        tone === "info"
          ? "border border-info-line bg-info-soft text-info-ink"
          : "border border-border bg-surface-2 text-ink-3",
        className,
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
      <p>{text}</p>
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
