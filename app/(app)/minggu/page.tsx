"use client";

import {
  ArrowRight,
  Bolt,
  CheckCircle2,
  Clock3,
  Download,
  Layers,
  Plus,
  Target,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/rph/status-badge";
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
import { createBlankRph, reuseLastWeek } from "@/lib/actions/plans";
import { currentWeek, weekDeadline } from "@/lib/config";
import { daySlot, deadlineLabel } from "@/lib/date";
import { CLASSES } from "@/lib/demo/seed";
import { useWeek } from "@/lib/hooks/use-week";
import { ms } from "@/lib/i18n/ms";
import type { RphDocument } from "@/lib/types";

const WEEK = currentWeek();

export default function MingguPage() {
  const router = useRouter();
  const me = useUser();
  const week = useWeek();

  const deadline = weekDeadline(WEEK);
  const approved = week.documents.filter((d) => d.status === "approved").length;
  const pct = week.total === 0 ? 0 : Math.round((approved / week.total) * 100);

  // "RPH baharu" has to mean *new*: resuming unfinished work is what the
  // per-row "Sambung" buttons are for. createBlankRph reuses an untouched
  // blank, so tapping this twice still lands on one empty plan.
  const onNew = async () => {
    const doc = await createBlankRph(WEEK, CLASSES);
    if (doc) router.push(`/editor/${doc.id}`);
    else toast.error("Tiada slot kosong untuk eRPH baharu");
  };

  const onReuse = async () => {
    const n = await reuseLastWeek(WEEK - 1, WEEK, CLASSES);
    toast.success(
      n > 0
        ? `${n} RPH minggu lepas disalin ke Minggu ${WEEK}`
        : "Tiada slot kosong — semua RPH minggu ini sudah wujud",
    );
  };

  return (
    <>
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
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onReuse}>
            <Layers className="h-4 w-4" strokeWidth={1.9} aria-hidden />
            {ms.dashboard.reuseLast}
          </Button>
          <Button onClick={onNew}>
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
          value="96"
          sub="%"
          icon={<Target className="h-4 w-4" strokeWidth={2} />}
          tone="ok"
          spark={[55, 72, 66, 84, 100, 78, 90]}
        />
      </div>

      {/* ── Weekly schedule ──────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">
          {ms.dashboard.weeklySchedule}
        </h2>
        <span className="h-px flex-1 bg-border" />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2">
          {CLASSES.length} kelas · 3 subjek
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
            <Shortcut
              icon={<Bolt className="h-4 w-4 text-primary" />}
              label="Jana RPH dengan AI"
              tag="Beta"
              onClick={() => toast("Pilih kelas → objektif & aktiviti dijana automatik")}
            />
            <Shortcut
              icon={<Upload className="h-4 w-4" />}
              label="Masukkan RPH sedia ada"
              onClick={() => toast("Muat naik .docx sedia ada — dipecahkan kepada medan RPH")}
            />
            <Shortcut
              icon={<Layers className="h-4 w-4" />}
              label="Templat sekolah"
              count={8}
              onClick={() => (window.location.href = "/templat")}
            />
            <Shortcut
              icon={<Download className="h-4 w-4" />}
              label="Eksport PDF minggu ini"
              onClick={() => toast("RPH minggu ini dijana sebagai PDF…")}
            />
            <div className="mt-1 flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft p-3 text-[12.5px] leading-[1.55] text-info-ink">
              <svg
                className="mt-0.5 h-4 w-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden
              >
                <path d="M2 2l20 20M8.6 16.6a5 5 0 0 1 6.8 0M5 12.5a10 10 0 0 1 4-2.4M15 10a10 10 0 0 1 4 2.5M12 20h.01" />
              </svg>
              <span>
                Boleh disediakan <b>secara luar talian</b> — disimpan pada peranti, disegerakkan
                automatik apabila capaian internet kembali.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
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
  tag,
  count,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tag?: string;
  count?: number;
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
      {tag && (
        <Badge variant="solid" className="ml-auto">
          {tag}
        </Badge>
      )}
      {count !== undefined && <span className="ml-auto text-[12px] text-ink-4">{count}</span>}
    </button>
  );
}
