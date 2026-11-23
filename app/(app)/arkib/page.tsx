"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Printer,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { CopyWeekDialog } from "@/components/rph/copy-week-dialog";
import { RphPaper } from "@/components/rph/rph-paper";
import { StatusBadge } from "@/components/rph/status-badge";
import { WeekSheets } from "@/components/rph/week-sheets";
import { useUser } from "@/components/shell/user-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { removePlan } from "@/lib/actions/plans";
import { cn } from "@/lib/cn";
import { supabaseConfigured, weekExists } from "@/lib/config";
import { longDateOf, schoolDays, weekRangeLabel } from "@/lib/date";
import { db } from "@/lib/db";
import { useCurrentWeek } from "@/lib/hooks/use-calendar";
import { useSchool } from "@/lib/hooks/use-school";
import { useSession } from "@/lib/hooks/use-session";
import { useSignature } from "@/lib/hooks/use-signature";
import { useArchive } from "@/lib/hooks/use-week";
import { RpcError, submitRph, submitRphBatch } from "@/lib/rpc";
import type { RphDocument } from "@/lib/types";
import { missingRequirements } from "@/lib/week-submit";

/** Plans grouped under one week, newest date first. */
interface WeekGroup {
  week: number;
  plans: RphDocument[];
  submitted: number;
  approved: number;
  returned: number;
  reviewer?: string | null;
  reviewed?: number;
}

function groupWeek(plans: RphDocument[]): WeekGroup {
  const submitted = plans.filter((r) => r.status !== "draft").length;
  const approved = plans.filter((r) => r.status === "approved").length;
  const returned = plans.filter((r) => r.status === "returned").length;
  const newest = plans
    .filter((r) => typeof r.reviewedAt === "number")
    .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0))[0];
  return {
    week: plans[0]?.weekNo ?? 0,
    plans: [...plans].sort((a, b) =>
      a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0,
    ),
    submitted,
    approved,
    returned,
    reviewer: newest?.reviewerName,
    reviewed: typeof newest?.reviewedAt === "number" ? newest.reviewedAt : undefined,
  };
}

function WeekPill({ group }: { group: WeekGroup }) {
  const { plans, approved, returned } = group;
  if (plans.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-3">
        Belum ada RPH
      </span>
    );
  }
  if (approved === plans.length) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-success-line bg-success-soft px-2.5 py-[3px] text-[11.5px] font-semibold text-success-ink">
        Lengkap semua
      </span>
    );
  }
  if (returned > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-danger-line bg-danger-soft px-2.5 py-[3px] text-[11.5px] font-semibold text-danger-ink">
        {returned} perlu dibaiki
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning-line bg-warning-soft px-2.5 py-[3px] text-[11.5px] font-semibold text-warning-ink">
      Dalam semakan
    </span>
  );
}

export default function ArkibPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const archive = useArchive() ?? [];
  const session = useSession();
  const me = useUser();
  const school = useSchool();
  const [confirming, setConfirming] = React.useState<RphDocument | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [exportStatus, setExportStatus] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const exportAbort = React.useRef<AbortController | null>(null);
  const [exportChoice, setExportChoice] = React.useState<{
    documents: RphDocument[];
    name: string;
  } | null>(null);
  async function exportZip(documents: RphDocument[], name: string, format: "pdf" | "docx") {
    if (exporting || documents.length === 0) return;
    setExportChoice(null);
    setExporting(true);
    setExportStatus("Memulakan eksport…");
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      const { downloadArchiveZip } = await import("@/lib/client/archive-export");
      await downloadArchiveZip(
        documents,
        name,
        me.fullName,
        school.name,
        format,
        setExportStatus,
        controller.signal,
      );
      setExportStatus(
        `${documents.length} RPH disediakan dalam ZIP (${format.toUpperCase()}).`,
      );
      toast.success("Fail ZIP telah disediakan.");
    } catch (error) {
      if (controller.signal.aborted) {
        setExportStatus("Eksport dibatalkan. Tiada ZIP dimuat turun.");
        toast.info("Eksport dibatalkan.");
        return;
      }
      const message = error instanceof Error ? error.message : "Eksport gagal.";
      setExportStatus(`Eksport gagal: ${message} Tiada ZIP dimuat turun.`);
      toast.error(`Eksport gagal: ${message}`);
    } finally {
      if (exportAbort.current === controller) exportAbort.current = null;
      setExporting(false);
    }
  }
  const [printJob, setPrintJob] = React.useState<{
    documents: RphDocument[];
    week: boolean;
  } | null>(null);
  const [copyWeek, setCopyWeek] = React.useState<{
    session: string;
    week: number;
    plans: RphDocument[];
  } | null>(null);
  const [submitWeek, setSubmitWeek] = React.useState<{
    session: string;
    week: number;
    plans: RphDocument[];
  } | null>(null);
  const [submitStatus, setSubmitStatus] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  /** Drafts and returned plans are the teacher's to send; nothing else is. */
  const canSubmit = (doc: RphDocument) => doc.status === "draft" || doc.status === "returned";

  /**
   * Send a returned RPH back for review.
   *
   * Drafts are still filed only as a whole week, but a returned plan has
   * already been reviewed. Holding its correction hostage to an unrelated
   * incomplete draft would block the feedback loop.
   */
  async function resubmitReturned(doc: RphDocument) {
    if (submitting || doc.status !== "returned") return;
    const missing = missingRequirements(doc.payload);
    if (missing.length > 0) {
      setSubmitStatus(
        `${doc.subjectName} · ${doc.planDate} belum lengkap: ${missing.join(", ")}.`,
      );
      toast.error(`RPH belum lengkap: ${missing.join(", ")}.`);
      return;
    }

    setSubmitting(true);
    setSubmitStatus(`Menghantar semula ${doc.subjectName} · ${doc.planDate}…`);
    try {
      if (!supabaseConfigured) {
        await db.documents.put({
          ...doc,
          status: "submitted",
          submittedAt: doc.submittedAt ?? Date.now(),
          grade: undefined,
          reviewedAt: undefined,
          clientUpdatedAt: Date.now(),
        });
      } else {
        const verdict = await submitRph(doc.id);
        if (!verdict) {
          throw new Error("Pelayan tidak tersedia - RPH tidak dihantar. Cuba lagi.");
        }
        if (!verdict.ok) {
          throw new Error(verdict.error ?? "RPH tidak dapat dihantar.");
        }
      }
      setSubmitStatus(`${doc.subjectName} · ${doc.planDate} dihantar semula untuk semakan.`);
      toast.success("RPH dihantar semula untuk semakan.");
      await queryClient.invalidateQueries({ queryKey: ["own-plans"] });
    } catch (error) {
      if (error instanceof RpcError && error.isAuthFailure) {
        toast.error("Sesi anda telah tamat. Sila log masuk semula.");
        window.setTimeout(() => window.location.assign("/login"), 1200);
        return;
      }
      const message = error instanceof Error ? error.message : "Gagal menghantar.";
      setSubmitStatus(
        `Gagal menghantar semula ${doc.subjectName} · ${doc.planDate}: ${message}`,
      );
      toast.error(`Gagal menghantar semula: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Submit the whole week.
   *
   * Drafts are filed as a whole week, so a teacher cannot file half a week by
   * accident. Returned plans also have their own resubmit action above.
   */
  async function submitWholeWeek() {
    if (submitting || !submitWeek) return;
    const plans = submitWeek.plans.filter(canSubmit);
    const week = submitWeek.week;
    setSubmitWeek(null);
    if (plans.length === 0) return;

    // All-or-nothing on completeness. Submitting the clean half of a week and
    // leaving the rest behind is how a teacher comes to believe the whole week
    // was handed in. Nothing is written until every plan can go.
    const incomplete = plans
      .map((doc) => ({ doc, missing: missingRequirements(doc.payload) }))
      .filter((entry) => entry.missing.length > 0);
    if (incomplete.length > 0) {
      const detail = incomplete
        .map(
          ({ doc, missing }) => `${doc.planDate} · ${doc.subjectName}: ${missing.join(", ")}`,
        )
        .join("; ");
      setSubmitStatus(
        `Minggu ${week} tidak dihantar - ${incomplete.length} daripada ${plans.length} RPH belum lengkap. ${detail}`,
      );
      toast.error(`Tiada RPH dihantar. ${incomplete.length} RPH perlu dilengkapkan dahulu.`);
      return;
    }

    setSubmitting(true);
    setSubmitStatus(`Menghantar ${plans.length} RPH minggu ${week}…`);
    try {
      if (supabaseConfigured) {
        // One transaction on the server: either the whole week is filed or
        // nothing is. The response names the plans it accepted.
        const result = await submitRphBatch(plans.map((doc) => doc.id));
        if (!result?.ok) throw new Error("Pelayan tidak mengesahkan penghantaran.");
        const sent = result.count ?? plans.length;
        setSubmitStatus(`${sent} RPH minggu ${week} dihantar untuk semakan.`);
        toast.success(`${sent} RPH dihantar untuk semakan.`);
        await queryClient.invalidateQueries({ queryKey: ["own-plans"] });
      } else {
        // Dexie has no server transaction; this one is local and atomic.
        await db.transaction("rw", db.documents, async () => {
          const now = Date.now();
          for (const doc of plans) {
            await db.documents.put({
              ...doc,
              status: "submitted",
              submittedAt: now,
              grade: undefined,
              clientUpdatedAt: now,
            });
          }
        });
        setSubmitStatus(`${plans.length} RPH minggu ${week} dihantar untuk semakan.`);
        toast.success(`${plans.length} RPH dihantar untuk semakan.`);
      }
    } catch (error) {
      if (error instanceof RpcError && error.isAuthFailure) {
        toast.error("Sesi anda telah tamat. Sila log masuk semula.");
        window.setTimeout(() => window.location.assign("/login"), 1200);
        return;
      }
      const message = error instanceof Error ? error.message : "Gagal menghantar.";
      setSubmitStatus(`Minggu ${week} tidak dihantar - ${message} Tiada RPH dihantar.`);
      toast.error(`Tiada RPH dihantar. ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  /** Plans that would block a whole-week submission, with what each one lacks. */
  const incompleteForSubmit =
    submitWeek?.plans
      .map((doc) => ({ doc, missing: missingRequirements(doc.payload) }))
      .filter((entry) => entry.missing.length > 0) ?? [];

  // Search across everything a teacher would remember a plan by: the class,
  // the subject, the topic, and the Standard Kandungan they wrote. A year is
  // forty-odd plans and the only other handle on this page is the week number,
  // which nobody remembers for a lesson written months ago.
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const docs = needle
    ? archive.filter((d) =>
        [
          d.classNames.join(" "),
          d.subjectName,
          d.payload.tajuk,
          d.payload.standard_kandungan,
        ].some((f) => f.toLowerCase().includes(needle)),
      )
    : archive;

  // Sessions newest first. The current one is the tree's home; older ones are
  // history the teacher can still open, copy from and (through the editor)
  // read, but not file new plans under.
  const sessions = React.useMemo(() => {
    const set = new Set(docs.map((d) => d.session).filter(Boolean));
    if (!needle && session && !set.has(session)) set.add(session);
    return [...set].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [docs, needle, session]);

  const bySessionWeek = React.useMemo(() => {
    const map = new Map<string, RphDocument[]>();
    for (const d of docs) {
      const key = `${d.session}::${d.weekNo}`;
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return map;
  }, [docs]);

  // Every week that has happened, not only the weeks with plans in them.
  // A week with nothing filed under it used not to appear here at all, which
  // hid the one week a teacher most needs to see - the one they missed.
  // While searching, only the weeks that match: a list of empty rows beside
  // a result is noise.
  const now = useCurrentWeek();
  const past = React.useMemo(
    () =>
      Array.from({ length: Math.max(0, now - 1) }, (_, i) => now - 1 - i).filter((w) =>
        weekExists(w),
      ),
    [now],
  );

  const weeksOf = React.useCallback(
    (s: string): number[] => {
      const withPlans = [...bySessionWeek.keys()]
        .filter((k) => k.startsWith(`${s}::`))
        .map((k) => Number(k.split("::")[1]));
      // Only weeks whose numbers have dates belonging to them. Plans filed
      // under a renumbered-away week still happened, and the archive is where
      // that history lives.
      const weeks = (
        needle || s !== session ? withPlans : [...new Set([...withPlans, ...past])]
      ).filter((w) => weekExists(w) || withPlans.includes(w));
      return [...new Set(weeks)].sort((a, b) => b - a);
    },
    [bySessionWeek, needle, past, session],
  );

  // Expansion. The current session opens on the newest week; anything the
  // teacher closed stays closed across renders. Searching overrides: every
  // branch holding a match opens, and clearing the search restores the manual
  // state rather than everything it was.
  const [openSessions, setOpenSessions] = React.useState<Set<string> | null>(null);
  const [openWeeks, setOpenWeeks] = React.useState<Set<string> | null>(null);

  const defaultSession = session || sessions[0];
  const defaultWeeks = React.useMemo(() => {
    if (!defaultSession) return new Set<string>();
    const weeks = weeksOf(defaultSession);
    const first = weeks[0];
    return new Set(first !== undefined ? [`${defaultSession}::${first}`] : []);
  }, [defaultSession, weeksOf]);

  const effSessions = openSessions ?? new Set(defaultSession ? [defaultSession] : []);
  const effWeeks = openWeeks ?? defaultWeeks;

  const toggleSession = (s: string) => {
    const next = new Set(effSessions);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setOpenSessions(next);
  };
  const toggleWeek = (key: string) => {
    const next = new Set(effWeeks);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenWeeks(next);
  };

  // While searching, every branch with a match stands open.
  const searching = needle.length > 0;
  const sessionOpen = (s: string) => (searching ? true : effSessions.has(s));
  const weekOpen = (key: string) => (searching ? true : effWeeks.has(key));

  const totalPlans = docs.length;

  return (
    <>
      <div data-print="screen">
        <p className="mb-3 text-xs leading-relaxed text-ink-3">
          Muat turun ZIP PDF atau ZIP DOCX untuk satu RPH, seminggu atau satu sesi. Eksport sesi
          yang besar mungkin mengambil masa. PDF ZIP menggunakan susun atur ringkas; gunakan
          Cetak untuk format borang sekolah.
        </p>
        {exportStatus && (
          <div
            role="status"
            className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-ink-2"
          >
            <p className="min-w-0 flex-1">{exportStatus}</p>
            {exporting && (
              <Button size="sm" variant="ghost" onClick={() => exportAbort.current?.abort()}>
                Batal eksport
              </Button>
            )}
          </div>
        )}
        {submitStatus && (
          <p
            role="status"
            className="mb-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-ink-2"
          >
            {submitStatus}
          </p>
        )}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Arkib eRPH</h2>
          <span className="num rounded-full border border-border bg-surface-2 px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-3">
            {searching ? `${totalPlans} daripada ${archive.length}` : `${totalPlans} rekod`}
          </span>
          <span className="h-px flex-1 bg-border" />
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4"
              strokeWidth={1.9}
              aria-hidden
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Cari dalam arkib"
              className="pl-9"
            />
          </div>
        </div>

        {sessions.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-ink-4">
              {searching ? `Tiada RPH sepadan dengan "${q.trim()}".` : "Belum ada rekod."}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {sessions.map((s) => {
            const sOpen = sessionOpen(s);
            const weeks = weeksOf(s);
            const sPlans = docs.filter((d) => d.session === s);
            return (
              <Card key={s}>
                <div>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => toggleSession(s)}
                      aria-expanded={sOpen}
                      aria-label={`Sesi ${s}, ${sPlans.length} RPH`}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                    >
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 text-ink-4 transition-transform duration-200",
                          sOpen && "rotate-90",
                        )}
                        aria-hidden
                      />
                      {sOpen ? (
                        <FolderOpen
                          className="h-[18px] w-[18px] shrink-0 text-warning-ink"
                          strokeWidth={1.9}
                          aria-hidden
                        />
                      ) : (
                        <Folder
                          className="h-[18px] w-[18px] shrink-0 text-warning-ink"
                          strokeWidth={1.9}
                          aria-hidden
                        />
                      )}
                      <span className="text-[14px] font-bold tracking-[-0.2px]">Sesi {s}</span>
                      <span className="num rounded-full border border-border bg-surface-2 px-2 py-px text-[11.5px] font-semibold text-ink-3">
                        {sPlans.length} RPH
                      </span>
                    </button>
                    {sPlans.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={exporting}
                        aria-label={`Muat turun ZIP sesi ${s}`}
                        onClick={() =>
                          setExportChoice({
                            documents: archive.filter((d) => d.session === s),
                            name: `RPH-Sesi-${s}`,
                          })
                        }
                      >
                        <Download className="h-4 w-4" aria-hidden /> ZIP
                      </Button>
                    )}
                  </div>

                  {sOpen && (
                    <div className="border-t border-border px-2 py-2 sm:px-3">
                      {weeks.length === 0 && (
                        <p className="px-2 py-6 text-center text-[12.5px] text-ink-4">
                          {searching
                            ? `Tiada RPH sepadan dengan "${q.trim()}".`
                            : "Belum ada RPH sesi ini."}
                        </p>
                      )}
                      {weeks.map((w) => {
                        const key = `${s}::${w}`;
                        const g = groupWeek(bySessionWeek.get(key) ?? []);
                        const wOpen = weekOpen(key);
                        const range = schoolDays(w);
                        const isCurrent = s === session;
                        // The whole week, not only the rows a search happens to
                        // show: submitting is about the record, not the filter.
                        const submittable = archive.filter(
                          (d) => d.session === s && d.weekNo === w && canSubmit(d),
                        );
                        return (
                          <div key={key}>
                            <div
                              className={cn(
                                "flex flex-wrap items-center gap-1 rounded-[10px] transition-colors",
                                wOpen ? "bg-surface-2/70" : "hover:bg-surface-2/50",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => toggleWeek(key)}
                                aria-expanded={wOpen}
                                aria-label={`Minggu ${w}, ${g.plans.length} RPH`}
                                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                              >
                                <ChevronRight
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform duration-200",
                                    wOpen && "rotate-90",
                                  )}
                                  aria-hidden
                                />
                                <CalendarDays
                                  className="h-4 w-4 shrink-0 text-primary-ink"
                                  strokeWidth={1.9}
                                  aria-hidden
                                />
                                <span className="num shrink-0 text-[13px] font-bold">
                                  Minggu {w}
                                </span>
                                {range[0] && (
                                  <span className="num hidden truncate text-[11.5px] text-ink-4 md:block">
                                    {weekRangeLabel(w)}
                                  </span>
                                )}
                                <span className="ml-auto flex shrink-0 items-center gap-2">
                                  {g.plans.length > 0 && (
                                    <span className="num text-[11.5px] text-ink-4">
                                      {g.submitted}/{g.plans.length}
                                    </span>
                                  )}
                                  <WeekPill group={g} />
                                </span>
                              </button>
                              {submittable.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={submitting}
                                  aria-label={`Hantar semua RPH minggu ${w}, sesi ${s} untuk semakan`}
                                  onClick={() =>
                                    setSubmitWeek({ session: s, week: w, plans: submittable })
                                  }
                                >
                                  <Send className="h-4 w-4" aria-hidden /> Hantar minggu
                                </Button>
                              )}
                              {g.plans.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={exporting}
                                  aria-label={`Muat turun ZIP minggu ${w}, sesi ${s}`}
                                  onClick={() =>
                                    setExportChoice({
                                      documents: archive.filter(
                                        (d) => d.session === s && d.weekNo === w,
                                      ),
                                      name: `RPH-${s}-Minggu-${w}`,
                                    })
                                  }
                                >
                                  <Download className="h-4 w-4" aria-hidden /> ZIP
                                </Button>
                              )}
                              {g.plans.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Salin semua RPH minggu ${w}, sesi ${s} ke minggu lain`}
                                  onClick={() =>
                                    setCopyWeek({
                                      session: s,
                                      week: w,
                                      plans: archive.filter(
                                        (d) => d.session === s && d.weekNo === w,
                                      ),
                                    })
                                  }
                                >
                                  <Copy className="h-4 w-4" aria-hidden /> Salin minggu
                                </Button>
                              )}
                              {g.plans.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Cetak semua RPH minggu ${w}, sesi ${s}`}
                                  onClick={() =>
                                    setPrintJob({
                                      documents: archive.filter(
                                        (d) => d.session === s && d.weekNo === w,
                                      ),
                                      week: true,
                                    })
                                  }
                                >
                                  <Printer className="h-4 w-4" aria-hidden /> Cetak
                                </Button>
                              )}
                              {isCurrent && !searching && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="mr-1 shrink-0"
                                  onClick={() => router.push(`/editor?week=${w}`)}
                                >
                                  Tambah RPH
                                </Button>
                              )}
                            </div>

                            {wOpen && (
                              <div className="ml-4 border-l border-border pl-3 sm:ml-5">
                                {g.plans.length === 0 ? (
                                  <div className="flex items-center justify-between gap-2 py-2 pr-1">
                                    <p className="text-[12.5px] text-ink-4">
                                      Tiada RPH minggu ini.
                                    </p>
                                    {isCurrent && !searching && (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => router.push(`/editor?week=${w}`)}
                                      >
                                        Tambah RPH
                                      </Button>
                                    )}
                                  </div>
                                ) : (
                                  <ul className="grid gap-1.5 py-1.5">
                                    {g.plans.map((d) => (
                                      <li
                                        key={d.id}
                                        className="flex items-center gap-2.5 rounded-[10px] border border-border/70 bg-surface px-3 py-2 transition-colors hover:border-border-strong"
                                      >
                                        <FileText
                                          className="h-4 w-4 shrink-0 text-ink-4"
                                          strokeWidth={1.9}
                                          aria-hidden
                                        />
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-[13px] font-semibold">
                                            {d.classNames.join(", ")} · {d.subjectName}
                                          </p>
                                          <p className="num truncate text-[11.5px] text-ink-3">
                                            {d.planDate}
                                            {d.payload.standard_kandungan
                                              ? ` · ${d.payload.standard_kandungan}`
                                              : ""}
                                          </p>
                                          {d.status === "returned" && d.reviewComment && (
                                            <p
                                              className="mt-1 line-clamp-2 text-[11.5px] leading-[1.45] text-danger-ink"
                                              title={d.reviewComment}
                                            >
                                              <span className="font-semibold">
                                                Catatan penyemak:{" "}
                                              </span>
                                              {d.reviewComment}
                                            </p>
                                          )}
                                        </div>
                                        <StatusBadge
                                          status={d.status}
                                          grade={d.grade}
                                          className="hidden shrink-0 sm:inline-flex"
                                        />
                                        <RowActions
                                          doc={d}
                                          exporting={exporting}
                                          submitting={submitting}
                                          canResubmit={d.status === "returned"}
                                          canDelete={
                                            d.status === "draft" || d.status === "returned"
                                          }
                                          onOpen={() => router.push(`/editor/${d.id}`)}
                                          onResubmit={() => void resubmitReturned(d)}
                                          onPrint={() =>
                                            setPrintJob({ documents: [d], week: false })
                                          }
                                          onZip={() =>
                                            setExportChoice({
                                              documents: [d],
                                              name: `RPH-${d.planDate}-${d.subjectName}`,
                                            })
                                          }
                                          onCopy={() => router.push(`/editor?copy=${d.id}`)}
                                          onDelete={() => setConfirming(d)}
                                        />
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {g.plans.length > 0 && (g.reviewer || g.reviewed) && (
                                  <p className="num pb-1.5 text-[11px] text-ink-4">
                                    Disemak terakhir
                                    {g.reviewer ? ` oleh ${g.reviewer}` : ""}
                                    {g.reviewed ? ` · ${longDateOf(g.reviewed)}` : ""}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <Dialog
          open={exportChoice !== null}
          onOpenChange={(open) => !open && setExportChoice(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Pilih format muat turun</DialogTitle>
              <DialogDescription>
                {exportChoice?.documents.length ?? 0} RPH akan dimuat turun dalam satu fail ZIP.
                Pilih satu format untuk setiap muat turun.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-3 sm:grid-cols-2">
              <Button
                disabled={exporting}
                onClick={() =>
                  exportChoice &&
                  void exportZip(exportChoice.documents, exportChoice.name, "pdf")
                }
              >
                Muat turun ZIP PDF
              </Button>
              <Button
                variant="secondary"
                disabled={exporting}
                onClick={() =>
                  exportChoice &&
                  void exportZip(exportChoice.documents, exportChoice.name, "docx")
                }
              >
                Muat turun ZIP DOCX
              </Button>
            </DialogBody>
          </DialogContent>
        </Dialog>

        <Dialog
          open={submitWeek !== null}
          onOpenChange={(open) => !open && !submitting && setSubmitWeek(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Hantar RPH minggu {submitWeek?.week} untuk semakan?</DialogTitle>
              <DialogDescription>
                {incompleteForSubmit.length > 0
                  ? `Minggu ini tidak boleh dihantar kerana ${incompleteForSubmit.length} RPH belum lengkap. Tiada RPH akan dihantar sehingga semuanya lengkap.`
                  : `${submitWeek?.plans.length ?? 0} RPH akan dihantar kepada penyemak sekolah.`}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              {incompleteForSubmit.length > 0 ? (
                <div className="rounded-[10px] border border-danger-line bg-danger-soft p-3 text-[12.5px] leading-[1.55] text-danger-ink">
                  <p className="font-semibold">Lengkapkan RPH berikut dahulu:</p>
                  <ul className="mt-1.5 grid gap-1.5">
                    {incompleteForSubmit.map(({ doc, missing }) => (
                      <li key={doc.id}>
                        <b>
                          {doc.subjectName} · {doc.classNames.join(", ")} · {doc.planDate}
                        </b>
                        <span className="block">Belum diisi: {missing.join(", ")}.</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2">
                    Buka setiap RPH di atas, lengkapkan bahagian yang dinyatakan, simpan,
                    kemudian hantar semula minggu ini.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-[13px] leading-[1.6] text-ink-3">
                    Selepas dihantar, RPH tidak lagi boleh disunting sehingga penyemak
                    mengembalikannya. Ejaan dan kandungan akan disemak oleh GPK atau Guru Besar.
                  </p>
                  <ul className="mt-3 grid gap-1 text-[12.5px] text-ink-3">
                    {submitWeek?.plans.map((doc) => (
                      <li key={doc.id} className="flex justify-between gap-3">
                        <span className="truncate">
                          {doc.subjectName} · {doc.classNames.join(", ")}
                        </span>
                        <span className="num shrink-0 text-ink-4">{doc.planDate}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" disabled={submitting} onClick={() => setSubmitWeek(null)}>
                {incompleteForSubmit.length > 0 ? "Tutup" : "Batal"}
              </Button>
              <Button
                disabled={submitting || incompleteForSubmit.length > 0}
                onClick={() => void submitWholeWeek()}
              >
                {submitting ? "Menghantar…" : `Hantar ${submitWeek?.plans.length ?? 0} RPH`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <CopyWeekDialog
          open={copyWeek !== null}
          onOpenChange={(open) => !open && setCopyWeek(null)}
          sourceSession={copyWeek?.session ?? session}
          sourceWeek={copyWeek?.week ?? 0}
          sourcePlans={copyWeek?.plans ?? []}
          archive={archive}
        />

        <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Keluarkan rancangan daripada arkib?</DialogTitle>
              <DialogDescription>
                {confirming
                  ? `${confirming.classNames.join(", ")} · ${confirming.subjectName} · ${confirming.planDate}`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <p className="text-[13px] leading-[1.6] text-ink-3">
                Rancangan ini tidak akan dipaparkan dalam arkib atau papan pemuka.
                <b className="text-ink-2"> Rekod tetap disimpan</b> mengikut Peraturan 8, Akta
                Pendidikan 1996 dan tidak dipadam daripada pangkalan data.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Batal
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  const target = confirming;
                  if (!target) return;
                  setBusy(true);
                  removePlan(target.id)
                    .then(() => {
                      toast.success("Rancangan dikeluarkan daripada arkib");
                      setConfirming(null);
                      return queryClient.invalidateQueries({ queryKey: ["own-plans"] });
                    })
                    .catch((err: unknown) =>
                      toast.error(err instanceof Error ? err.message : "Gagal memadam"),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Keluarkan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {printJob && (
        <ArchivePrintJob
          key={`${printJob.week ? "week" : "plan"}:${printJob.documents.map((d) => d.id).join(",")}`}
          {...printJob}
          onDone={() => setPrintJob(null)}
        />
      )}
    </>
  );
}

/**
 * The per-plan actions: Buka, a returned-only resubmit, and an overflow menu.
 *
 * Drafts are still filed as a whole week from the week header. A returned plan
 * gets its own resubmit action because that is the correction loop, not a
 * second way to file unfinished work.
 */
function RowActions({
  doc,
  exporting,
  submitting,
  canResubmit,
  canDelete,
  onOpen,
  onResubmit,
  onPrint,
  onZip,
  onCopy,
  onDelete,
}: {
  doc: RphDocument;
  exporting: boolean;
  submitting: boolean;
  canResubmit: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onResubmit: () => void;
  onPrint: () => void;
  onZip: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const label = `${doc.classNames.join(", ")} ${doc.subjectName} ${doc.planDate}`;

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={ref} className="relative flex shrink-0 items-center gap-1">
      {canResubmit && (
        <Button
          size="sm"
          variant="secondary"
          disabled={submitting}
          aria-label={`Hantar semula ${label} untuk semakan`}
          onClick={onResubmit}
        >
          <Send className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
          <span className="hidden sm:inline">Hantar semula</span>
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onOpen}>
        Buka
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Tindakan lain untuk ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden />
      </Button>

      {open && (
        <div
          role="menu"
          aria-label={`Tindakan untuk ${label}`}
          className="absolute top-full right-0 z-30 mt-1 w-48 rounded-[10px] border border-border bg-surface p-1 shadow-lg"
        >
          <MenuItem
            icon={Printer}
            label={`Cetak ${label}`}
            text="Cetak"
            onSelect={() => choose(onPrint)}
          />
          <MenuItem
            icon={Download}
            label={`Muat turun ZIP ${label}`}
            text="Muat turun ZIP"
            disabled={exporting}
            onSelect={() => choose(onZip)}
          />
          <MenuItem
            icon={Copy}
            label={`Salin ${label}`}
            text="Salin"
            onSelect={() => choose(onCopy)}
          />
          {/* Only working copies can be withdrawn: a filed plan is under
              review or sealed, and the server refuses those with a 409. */}
          {canDelete && (
            <>
              <div className="my-1 border-t border-border" aria-hidden />
              <MenuItem
                icon={Trash2}
                label={`Padam ${label}`}
                text="Padam"
                danger
                onSelect={() => choose(onDelete)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  text,
  onSelect,
  disabled,
  danger,
}: {
  icon: typeof Printer;
  label: string;
  text: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Button
      role="menuitem"
      size="sm"
      variant="ghost"
      disabled={disabled}
      aria-label={label}
      onClick={onSelect}
      className={cn("w-full justify-start", danger && "text-danger-ink hover:bg-danger-soft")}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
      {text}
    </Button>
  );
}

function ArchivePrintJob({
  documents,
  week,
  onDone,
}: {
  documents: RphDocument[];
  week: boolean;
  onDone: () => void;
}) {
  const me = useUser();
  const school = useSchool();
  const first = documents[0];
  const signed = week
    ? documents
        .filter((d) => d.status === "approved")
        .sort((a, b) => b.clientUpdatedAt - a.clientUpdatedAt)[0]
    : first?.status === "approved"
      ? first
      : undefined;
  const signature = useSignature(signed?.id, signed?.payload);
  const printed = React.useRef(false);
  React.useEffect(() => {
    if (signature.loading || printed.current) return;
    printed.current = true;
    window.print();
    onDone();
  }, [signature.loading, onDone]);
  if (!first) return null;
  return (
    <div data-print="page" className="hidden">
      {week ? (
        <WeekSheets
          weekNo={first.weekNo}
          session={first.session}
          teacherName={me.fullName}
          schoolName={school.name}
          documents={documents}
          signature={signature.signature}
          signatureState={signature.state}
        />
      ) : (
        <RphPaper
          payload={first.payload}
          session={first.session}
          weekNo={first.weekNo}
          planDate={first.planDate}
          slotTime={first.slotTime}
          slotTimeEnd={first.slotTimeEnd}
          planClassName={first.classNames.join(", ")}
          subjectName={first.subjectName}
          teacherName={me.fullName}
          schoolName={school.name}
          signature={signature.signature}
          signatureState={signature.state}
        />
      )}
    </div>
  );
}
