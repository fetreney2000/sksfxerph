"use client";

import {
  ArrowRight,
  Bolt,
  CheckCircle2,
  Clock3,
  Layers,
  Plus,
  Printer,
  Target,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/rph/status-badge";
import { WeekSheets } from "@/components/rph/week-sheets";
import { givenName, useUser } from "@/components/shell/user-context";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { reuseLastWeek } from "@/lib/actions/plans";
import { can } from "@/lib/auth/permissions";
import { currentWeek, weekDeadline } from "@/lib/config";
import { daySlot, deadlineLabel } from "@/lib/date";
import { useSchoolStats } from "@/lib/hooks/use-remote";
import { useSchoolClasses, useSchoolSubjects } from "@/lib/hooks/use-school-data";
import { useSignature } from "@/lib/hooks/use-signature";
import { useWeek } from "@/lib/hooks/use-week";
import { ms } from "@/lib/i18n/ms";
import { parseDocx } from "@/lib/import/docx";
import { stashImport } from "@/lib/import/pending";
import { currentSession } from "@/lib/session";
import type { RphDocument } from "@/lib/types";

const WEEK = currentWeek();

export default function MingguPage() {
  const router = useRouter();
  const me = useUser();
  const week = useWeek();
  const stats = useSchoolStats();
  const { items: classes } = useSchoolClasses();
  const { items: subjects } = useSchoolSubjects();

  const deadline = weekDeadline(WEEK);
  const approved = week.documents.filter((d) => d.status === "approved").length;
  const pct = week.total === 0 ? 0 : Math.round((approved / week.total) * 100);

  // "RPH baharu" has to mean *new*: resuming unfinished work is what the
  // per-row "Sambung" buttons are for. It now navigates rather than creating —
  // the penyunting opens blank and the teacher saves when there is something
  // worth saving, so a mis-tap leaves nothing behind.
  const onNew = () => {
    router.push("/editor");
  };

  const onReuse = async () => {
    const n = await reuseLastWeek(WEEK - 1, WEEK, classes);
    toast.success(
      n > 0
        ? `${n} RPH minggu lepas disalin ke Minggu ${WEEK}`
        : "Tiada slot kosong — semua RPH minggu ini sudah wujud",
    );
  };

  /**
   * The week's pentadbir, for the cover sheet.
   *
   * Signatures are per plan, but the cover carries one — and every plan in a
   * week is sealed by the same person, so any of them speaks for the sheet.
   * The newest is taken rather than the first: if the week was returned and
   * then re-approved, the cover should carry the approval that stands, not
   * the rejection that preceded it.
   */
  const sealedPlan = useMemo(() => {
    const approved = week.documents.filter((d) => d.status === "approved");
    if (approved.length === 0) return undefined;
    return approved.reduce((a, b) => (a.clientUpdatedAt >= b.clientUpdatedAt ? a : b));
  }, [week.documents]);
  const weekSignature = useSignature(sealedPlan?.id, sealedPlan?.payload);

  // The whole week, or nothing: a stack with one plan missing is a stack the
  // district will send back, so it is better for the teacher to see the gap
  // here than on paper.
  const printable = week.documents.filter((d) => d.status !== "draft");

  const onPrint = () => window.print();

  /**
   * Bring an existing .docx RPH into the penyunting.
   *
   * The parse is heuristic — Word documents disagree about labels — so
   * nothing is saved here. The file is read, stashed and handed to the
   * penyunting, where the teacher corrects it and presses Simpan like any
   * other plan. Importing a file must not leave a draft behind if they
   * look at the result and decide against it.
   */
  const fileRef = useRef<HTMLInputElement>(null);

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = await parseDocx(file);
      stashImport(imported);
      router.push("/editor");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fail ini tidak dapat dibaca.");
    }
  };

  return (
    <>
      {/* Screen-only. `@media print` drops this and shows the sheets below
          instead, so printing the week does not also print the dashboard the
          teacher was looking at when they pressed the button. */}
      <div data-print="screen">
        {/* ── Greeting ─────────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[21px] font-extrabold tracking-[-0.6px]">
              {ms.dashboard.greeting}, {givenName(me.fullName)}
            </h2>
            <p className="text-[13px] text-ink-3">
              Anda sudah menghantar{" "}
              <b className="text-ink">
                {week.submitted} daripada {week.total || "—"}
              </b>{" "}
              RPH minggu ini.
              {week.drafts > 0 && ` Tinggal ${week.drafts} sebelum Jumaat.`}
            </p>
          </div>
          {/* Wraps on a narrow screen rather than pushing the page sideways:
            two long Malay labels side by side measure more than a 375px phone
            has after the page's own padding, and a flex row does not wrap or
            shrink on its own. */}
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onReuse}>
              <Layers className="h-4 w-4" strokeWidth={1.9} aria-hidden />
              {ms.dashboard.reuseLast}
            </Button>
            <Button
              variant="secondary"
              className="flex-1 sm:flex-none"
              onClick={onPrint}
              // Nothing to print yet. A cover sheet over an empty week is a page
              // that says a teacher teaches nothing.
              disabled={printable.length === 0}
            >
              <Printer className="h-4 w-4" strokeWidth={1.9} aria-hidden />
              {ms.dashboard.printWeek}
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={onNew}>
              <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden />
              {ms.dashboard.newRph}
            </Button>
          </div>
        </div>

        {/* ── Deadline banner ──────────────────────────────────────────────── */}
        <div className="relative mb-4 flex items-center gap-4 overflow-hidden rounded-[14px] border border-primary-soft-2 bg-gradient-to-r from-primary-soft to-surface p-4">
          <span className="grid h-10.5 w-10.5 shrink-0 place-items-center rounded-[11px] border border-primary-soft-2 bg-surface text-primary shadow-xs">
            <Clock3 className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold tracking-[-0.15px]">
              {ms.dashboard.deadline}: <span className="num">{deadlineLabel(deadline)}</span>
            </h4>
            <p className="text-[12.8px] text-ink-2">
              {week.drafts > 0 ? (
                <>
                  <b>{week.drafts} RPH</b> belum dihantar untuk Minggu {WEEK}.{" "}
                </>
              ) : null}
              <b>{ms.dashboard.noPrint}</b>
            </p>
            <Progress
              value={pct}
              tone={pct >= 80 ? "success" : "primary"}
              className="mt-2 max-w-[420px]"
            />
          </div>
          <Link
            href="/editor"
            className="hidden shrink-0 sm:block"
            onClick={(e) => {
              e.preventDefault();
              void onNew();
            }}
          >
            <Button>
              {ms.dashboard.newRph}
              <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />
            </Button>
          </Link>
        </div>

        {/* ── Stats ────────────────────────────────────────────────────────── */}
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={`${ms.dashboard.submitted} · Minggu ${WEEK}`}
            value={`${week.submitted}`}
            sub={` / ${week.total}`}
            icon={<CheckCircle2 className="h-4 w-4" strokeWidth={2} />}
            tone="ok"
            footer={<Progress value={pct} tone="success" />}
          />
          <StatCard
            label={ms.dashboard.waiting}
            value={String(week.waiting)}
            icon={<Clock3 className="h-4 w-4" strokeWidth={2} />}
            badge={week.waiting > 0 ? <Badge variant="info">Dihantar</Badge> : undefined}
          />
          <StatCard
            label={ms.dashboard.needsAction}
            value={String(week.returned)}
            icon={<Bolt className="h-4 w-4" strokeWidth={2} />}
            tone="bad"
            badge={
              week.returned > 0 ? <Badge variant="danger">Dikembalikan · GPK</Badge> : undefined
            }
          />
          <StatCard
            label={ms.dashboard.onTime}
            value={week.onTimePct === null ? "—" : String(week.onTimePct)}
            sub={week.onTimePct === null ? "" : "%"}
            icon={<Target className="h-4 w-4" strokeWidth={2} />}
            tone={week.onTimePct === null || week.onTimePct >= 80 ? "ok" : "bad"}
          />
        </div>

        {/* ── School totals ─────────────────────────────────────────────────
          Aggregates only — `school_week_stats` returns counts, never names.
          Every role may see this; the per-teacher table, the reminders and
          the exports live behind `/sekolah`, which needs `pantau`. */}
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 py-3.5">
            <div className="min-w-[176px]">
              <p className="text-[11.5px] font-bold tracking-[0.7px] text-ink-4 uppercase">
                Sekolah · Minggu {WEEK}
              </p>
              <p className="mt-0.5 text-[13.5px] text-ink-2">
                <b className="num text-ink">{stats.submitted}</b>
                <span className="text-ink-4"> / {stats.totalExpected}</span> RPH dihantar
              </p>
            </div>
            <div className="min-w-[180px] flex-1">
              <p className="mb-1.5 text-[12.5px] text-ink-3">
                <b className="num text-ink">{stats.compliancePct}%</b> pematuhan sekolah
              </p>
              <Progress value={stats.compliancePct} tone="success" />
            </div>
            {can(me.role, "pantau") && (
              <Button variant="secondary" size="sm" onClick={() => router.push("/sekolah")}>
                Paparan Sekolah
                <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />
              </Button>
            )}
          </CardContent>
        </Card>

        {/* ── Weekly schedule ──────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">
            {ms.dashboard.weeklySchedule}
          </h2>
          <span className="h-px flex-1 bg-border" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2">
            {classes.length} kelas · {subjects.length} subjek
          </span>
        </div>

        <Card className="mb-4">
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Kelas &amp; Subjek</TH>
                  <TH>Tarikh / Masa</TH>
                  <TH>Standard Kandungan</TH>
                  <TH>Status</TH>
                  <TH>Penyemak</TH>
                  <TH className="text-right">Tindakan</TH>
                </tr>
              </THead>
              <TBody>
                {week.loading && (
                  <tr>
                    <TD colSpan={6} className="py-8 text-center text-ink-4">
                      Memuatkan…
                    </TD>
                  </tr>
                )}
                {!week.loading && week.documents.length === 0 && (
                  <tr>
                    <TD colSpan={6} className="py-10 text-center">
                      <p className="mb-3 text-ink-3">Tiada RPH lagi untuk Minggu {WEEK}.</p>
                      <Button size="sm" onClick={() => void onNew()}>
                        <Plus className="h-4 w-4" aria-hidden /> {ms.dashboard.newRph}
                      </Button>
                    </TD>
                  </tr>
                )}
                {week.documents.map((doc) => (
                  <PlanRow key={doc.id} doc={doc} />
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </Card>

        {/* ── Feed + shortcuts ─────────────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-[1fr_348px]">
          <Card>
            <CardHeader>
              <CardTitle>{ms.dashboard.activity}</CardTitle>
              <CardDescription>Kemas kini langsung</CardDescription>
              <span className="ml-auto">
                <Badge variant="success">Masa nyata</Badge>
              </span>
            </CardHeader>
            <CardContent className="pt-1 pb-2">
              <ul className="list-none">
                {week.documents
                  .filter((d) => d.status !== "draft")
                  .slice(0, 4)
                  .map((d) => (
                    <li
                      key={d.id}
                      className="flex gap-3 border-b border-dashed border-border py-3 last:border-b-0"
                    >
                      <Avatar initials="ZR" tone="teal" />
                      <div className="min-w-0">
                        <p className="text-[12.8px] leading-[1.5] text-ink-2">
                          <b className="text-ink">Zulkifli (GPK)</b>{" "}
                          {d.status === "approved"
                            ? "mengesahkan"
                            : d.status === "returned"
                              ? "mengembalikan"
                              : d.status === "forwarded"
                                ? "meneruskan kepada Guru Besar"
                                : "menerima"}{" "}
                          <b className="text-ink">
                            RPH {d.className} · {d.subjectName}
                          </b>{" "}
                          <span
                            className="font-bold"
                            style={{
                              color:
                                d.status === "approved"
                                  ? "var(--color-success-ink)"
                                  : d.status === "returned"
                                    ? "var(--color-danger-ink)"
                                    : "var(--color-info-ink)",
                            }}
                          >
                            {d.status === "approved"
                              ? ms.status.approved
                              : d.status === "returned"
                                ? "Tidak lengkap (0)"
                                : d.status === "forwarded"
                                  ? ms.status.forwarded
                                  : ms.status.submitted}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink-4">
                          {daySlot(d.planDate, d.slotTime)}
                        </p>
                      </div>
                    </li>
                  ))}
                {week.documents.filter((d) => d.status !== "draft").length === 0 && (
                  <li className="py-6 text-center text-[13px] text-ink-4">
                    Belum ada aktiviti semakan minggu ini.
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{ms.dashboard.shortcuts}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              <input
                ref={fileRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                onChange={(e) => {
                  // Reset after handling: without it, choosing the same file
                  // twice fires nothing, and a teacher correcting a document
                  // and re-uploading it is exactly the case that matters.
                  void onImportFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Shortcut
                icon={<Upload className="h-4 w-4" />}
                label="Masukkan RPH sedia ada"
                onClick={() => fileRef.current?.click()}
              />
              {/* No count shown. The number would have to come from a query
                  this page does not make, and a badge that reads "8" because
                  someone typed 8 is worse than no badge — the teacher opens
                  /templat expecting eight and finds however many there are. */}
              <Shortcut
                icon={<Layers className="h-4 w-4" />}
                label="Templat sekolah"
                onClick={() => (window.location.href = "/templat")}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* The artefact. `hidden` on screen — it is not a preview, it is the
          thing the printer takes — and `@media print` in globals.css makes it
          the whole page. */}
      {printable.length > 0 && (
        <div data-print="page" className="hidden">
          <WeekSheets
            weekNo={WEEK}
            session={currentSession()}
            teacherName={me.fullName}
            documents={printable}
            signature={weekSignature.signature}
            signatureState={weekSignature.state}
          />
        </div>
      )}
    </>
  );
}

function PlanRow({ doc }: { doc: RphDocument }) {
  const router = useRouter();
  const actionable = doc.status === "draft" || doc.status === "returned";

  return (
    <TR className={doc.status === "draft" ? "bg-primary-soft" : undefined}>
      <TD>
        <div className="flex items-center gap-2.5">
          <Avatar initials={doc.className.slice(0, 2)} tone="blue" small />
          <div className="min-w-0">
            <div className="truncate font-semibold">
              {doc.className} · {doc.subjectName}
            </div>
            <div className="text-[11.5px] text-ink-3">{doc.subjectCode}</div>
          </div>
        </div>
      </TD>
      <TD className="num whitespace-nowrap">{daySlot(doc.planDate, doc.slotTime)}</TD>
      <TD>
        <span className="ellip block max-w-[250px]">
          {doc.payload.standard_kandungan || "—"}
        </span>
      </TD>
      <TD>
        <StatusBadge status={doc.status} grade={doc.grade} />
      </TD>
      <TD>
        {doc.status === "draft" ? (
          <span className="text-[12.5px] text-ink-4">—</span>
        ) : (
          <div className="flex items-center gap-2.5">
            <Avatar initials="ZR" tone="teal" small />
            <span className="text-[12.5px]">Zulkifli · GPK</span>
          </div>
        )}
      </TD>
      <TD className="text-right">
        <Button
          size="sm"
          variant={
            doc.status === "approved"
              ? "ghost"
              : doc.status === "returned"
                ? "danger"
                : actionable
                  ? "primary"
                  : "secondary"
          }
          onClick={() => router.push(`/editor/${doc.id}`)}
        >
          {doc.status === "approved"
            ? "Lihat"
            : doc.status === "returned"
              ? "Baiki"
              : doc.status === "draft"
                ? "Sambung"
                : "Lihat"}
        </Button>
      </TD>
    </TR>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "primary",
  badge,
  footer,
  spark,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: "primary" | "ok" | "bad";
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  spark?: number[];
}) {
  return (
    <Card className="relative overflow-hidden p-4">
      <span
        className="absolute inset-x-0 top-0 h-0.5"
        style={{
          background:
            tone === "ok"
              ? "linear-gradient(90deg,#079455,transparent)"
              : tone === "bad"
                ? "linear-gradient(90deg,#d92d20,transparent)"
                : "linear-gradient(90deg,#175cd3,transparent)",
        }}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink-3">{label}</span>
        <span
          className={
            "grid h-8 w-8 place-items-center rounded-[9px] " +
            (tone === "ok"
              ? "bg-success-soft text-success-ink"
              : tone === "bad"
                ? "bg-danger-soft text-danger-ink"
                : "bg-primary-soft text-primary-ink")
          }
          aria-hidden
        >
          {icon}
        </span>
      </div>
      <div className="num mt-1.5 text-[28px] leading-none font-extrabold tracking-[-1.2px]">
        {value}
        {sub && (
          <small className="text-sm font-semibold tracking-normal text-ink-4">{sub}</small>
        )}
      </div>
      {badge && <div className="mt-2">{badge}</div>}
      {footer && <div className="mt-2">{footer}</div>}
      {spark && (
        <div className="mt-1 flex h-6 items-end gap-[3px]">
          {spark.map((v, i) => (
            <span
              key={i}
              className={`w-[7px] rounded-[2.5px] ${v === 100 ? "bg-primary" : "bg-primary-soft-2"}`}
              style={{ height: `${v}%` }}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function Shortcut({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[9px] border border-border-strong bg-surface px-3 py-2.5 text-[13.5px] font-semibold text-ink-2 shadow-xs transition-colors hover:bg-surface-3"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
