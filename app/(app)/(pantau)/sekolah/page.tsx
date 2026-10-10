"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, Download, Users } from "lucide-react";
import { toast } from "sonner";
import type { TeacherRow } from "@/app/api/pantau/teachers/route";
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
import { currentWeek, supabaseConfigured } from "@/lib/config";
import { TEACHER_ROWS } from "@/lib/demo/review";
import { useSchoolStats } from "@/lib/hooks/use-remote";
import { ms } from "@/lib/i18n/ms";
import type { MemberRole } from "@/lib/types";

const WEEK = currentWeek();

const RANGES = ["Minggu 6", "Minggu 5", "4 minggu", "Sepanjang sesi"] as const;

/** What the table renders, whichever source produced it. */
interface Row {
  id: string;
  name: string;
  initials: string;
  tone: "blue" | "teal" | "plum";
  role: string;
  classes: string;
  week: "Lengkap" | "Menunggu" | "Lewat" | "Tiada";
  compliance: number;
  last: string;
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ms-MY", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * Counts into words.
 *
 * "Tiada" is deliberately distinct from "Lewat": a teacher who has not started
 * this week's plan yet and one whose plan is late need different conversations,
 * and collapsing both into "not submitted" loses the only difference the
 * supervisor can act on.
 */
function weekState(total: number, done: number): Row["week"] {
  if (total === 0) return "Tiada";
  if (done >= total) return "Lengkap";
  if (done === 0) return "Lewat";
  return "Menunggu";
}

const WEEK_TONE = {
  Lengkap: "success",
  Menunggu: "info",
  Lewat: "danger",
  Tiada: "neutral",
} as const;

function fromApi(r: TeacherRow): Row {
  return {
    id: r.userId,
    name: r.fullName,
    initials: initialsOf(r.fullName),
    tone: "blue",
    role: ms.roles[r.role as MemberRole] ?? r.role,
    classes: r.classes ?? "—",
    week: weekState(r.weekTotal, r.weekDone),
    compliance: r.sessionTotal === 0 ? 0 : Math.round((r.sessionDone / r.sessionTotal) * 100),
    last: r.lastReviewedAt ? shortDate(r.lastReviewedAt) : "—",
  };
}

export default function SekolahPage() {
  // school_week_stats RPC when configured, bundled demo figures otherwise.
  const s = useSchoolStats();
  const maxPct = Math.max(...s.weeks.map((w) => w.pct));

  // Gated on `pantau`, and narrowed again inside erph.pantau_teachers to the
  // teachers this reviewer actually supervises — so a GPK's table is their
  // own teachers and nobody else's, while the aggregate cards above stay
  // school-wide for both roles.
  const teachers = useQuery<{ items: TeacherRow[] }>({
    queryKey: ["pantau-teachers"],
    queryFn: async () => {
      const res = await fetch("/api/pantau/teachers", { credentials: "same-origin" });
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: TeacherRow[] };
    },
    enabled: supabaseConfigured,
    retry: false,
  });

  const rows: Row[] = supabaseConfigured
    ? (teachers.data?.items ?? []).map(fromApi)
    : TEACHER_ROWS.map((t) => ({
        id: t.name,
        name: t.name,
        initials: t.initials,
        tone: t.tone,
        role: t.role,
        classes: t.panel,
        week: t.week,
        compliance: t.compliance,
        last: t.last,
      }));

  // Not "not submitted" — "Lewat" means their plan exists but is not approved,
  // and "Tiada" means this week has nothing at all. Both need a nudge; neither
  // is the same as a teacher who is simply mid-task, which is Menunggu.
  const lateCount = rows.filter((r) => r.week === "Lewat" || r.week === "Tiada").length;

  return (
    <>
      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r, i) => (
            <button
              key={r}
              type="button"
              aria-pressed={i === 0}
              className={
                "rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors " +
                (i === 0
                  ? "border-ink bg-ink text-surface"
                  : "border-border-strong bg-surface text-ink-2 hover:bg-surface-3")
              }
            >
              {r}
            </button>
          ))}
        </div>
        <span className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toast("Eksport CSV / PDF laporan sekolah")}
          >
            <Download className="h-4 w-4" strokeWidth={1.9} aria-hidden /> Eksport
          </Button>
          <Button
            size="sm"
            onClick={() => toast("3 peringatan dihantar kepada guru yang belum menghantar")}
          >
            <Bell className="h-4 w-4" strokeWidth={1.9} aria-hidden /> Hantar peringatan
          </Button>
        </span>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Guru aktif"
          value={String(s.activeTeachers)}
          sub="semua hantar ≥ 1 RPH"
          icon={<Users className="h-4 w-4" />}
        />
        <Stat
          label="RPH minggu ini"
          value={String(s.submitted)}
          sub={` / ${s.totalExpected}`}
          bar={(s.submitted / s.totalExpected) * 100}
        />
        <Stat
          label="Kadar pematuhan"
          value={String(s.compliancePct)}
          sub="%"
          spark={s.weeks.map((w) => w.pct)}
        />
        <Stat
          label="Purata masa siap"
          value={String(s.avgMinutes)}
          sub=" minit"
          trend="▼ 2.1 minit sejak guna templat"
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_348px]">
        {/* ── Chart ──────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Penghantaran mengikut minggu</CardTitle>
            <CardDescription>Sesi 2026/2027</CardDescription>
            <span className="ml-auto">
              <Badge variant="success">▲ 6% sejak M1</Badge>
            </span>
          </CardHeader>
          <CardContent>
            {/*
              Hand-rolled bar chart: six columns do not justify a chart library,
              and divs give us the exact styling control the mockup specified
              (erph-frontend-stack.md §9 — chart libs are on the excluded list).
            */}
            <div
              className="relative flex h-45 items-end gap-3 border-b border-border-strong px-1 pb-0"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to top, var(--color-border) 0 1px, transparent 1px 44px)",
              }}
              role="img"
              aria-label="Carta penghantaran RPH mengikut minggu"
            >
              {s.weeks.map((w) => (
                <div
                  key={w.week}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                >
                  <span className="num text-[10.5px] font-bold text-ink-3">{w.pct}%</span>
                  <span
                    className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-md shadow-xs"
                    style={{ height: `${(w.pct / maxPct) * 78}%` }}
                  >
                    <span style={{ height: `${w.pct}%`, background: "#12b76a" }} />
                    <span style={{ height: `${100 - w.pct}%`, background: "#f04438" }} />
                  </span>
                  <span className="text-[11px] font-bold text-ink-4">M{w.week}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex gap-5 text-xs text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-[#12b76a]" /> Lengkap (1)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-[#f04438]" /> Tidak lengkap /
                lewat (0)
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ── By panel ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Mengikut bidang</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {s.byPanel.map((p) => (
              <div key={p.label}>
                <div className="mb-1.5 flex justify-between border-none p-0 text-[13px]">
                  <span className="text-ink-3">{p.label}</span>
                  <span className="num font-bold">{p.pct}%</span>
                </div>
                <Progress value={p.pct} tone={p.pct >= 95 ? "success" : "warning"} />
              </div>
            ))}
            <div className="flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft p-3 text-[12.5px] leading-[1.55] text-info-ink">
              <Bell className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
              <div>
                {lateCount > 0 ? (
                  <>
                    {lateCount} guru belum menghantar. Peringatan automatik:{" "}
                    <b>Khamis 4:00 petang</b>, ingatan akhir Jumaat 8:00 pagi.
                  </>
                ) : (
                  <>Semua guru dalam bidang anda telah menghantar untuk minggu ini.</>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Teacher table ────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Prestasi guru</h2>
        <span className="h-px flex-1 bg-border" />
        <span className="num text-xs text-ink-3">
          {/* Not "…daripada 42 guru". That denominator came from the bundled
              demo figure, which `useSchoolStats` never overrode — so it sat
              beside live rows claiming a school-wide total, and for a GPK it
              was wrong twice over: not the school, and not their scope either.
              `pantau_teachers` returns the full set this reviewer may see, so
              the list *is* the population; there is no honest denominator to
              add. */}
          {supabaseConfigured
            ? `${rows.length} guru`
            : `Memaparkan ${rows.length} daripada ${s.activeTeachers} guru`}
        </span>
      </div>

      <Card>
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>Guru</TH>
                <TH>Bidang / Kelas</TH>
                <TH>Minggu {WEEK}</TH>
                <TH>Pematuhan sesi</TH>
                <TH>Terakhir disemak</TH>
                <TH className="text-right">Tindakan</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={t.initials} tone={t.tone} small />
                      <div>
                        <div className="font-semibold">{t.name}</div>
                        {t.role && <div className="text-[11.5px] text-ink-3">{t.role}</div>}
                      </div>
                    </div>
                  </TD>
                  <TD className="text-ink-3">{t.classes}</TD>
                  <TD>
                    <Badge variant={WEEK_TONE[t.week]}>{t.week}</Badge>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Progress
                        value={t.compliance}
                        tone={t.compliance >= 90 ? "success" : "warning"}
                        className="min-w-22 flex-1"
                      />
                      <span className="num text-[12.5px] font-semibold">{t.compliance}%</span>
                    </div>
                  </TD>
                  <TD className="num text-[12.5px] text-ink-3">{t.last}</TD>
                  <TD className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        toast(
                          t.week === "Lewat" || t.week === "Tiada"
                            ? `Peringatan dihantar kepada ${t.name}`
                            : `Memanggil senarai RPH ${t.name}`,
                        )
                      }
                    >
                      {t.week === "Lewat" || t.week === "Tiada" ? "Peringat" : "Semak"}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </Card>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  icon,
  bar,
  spark,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  bar?: number;
  spark?: number[];
  trend?: string;
}) {
  return (
    <Card className="relative overflow-hidden p-4">
      <span
        className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary to-transparent"
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink-3">{label}</span>
        {icon && (
          <span
            className="grid h-8 w-8 place-items-center rounded-[9px] bg-primary-soft text-primary-ink"
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
      <div className="num mt-1.5 text-[28px] leading-none font-extrabold tracking-[-1.2px]">
        {value}
        {sub && (
          <small className="text-sm font-semibold tracking-normal text-ink-4">{sub}</small>
        )}
      </div>
      {bar !== undefined && (
        <div className="mt-2">
          <Progress value={bar} tone="success" />
        </div>
      )}
      {trend && (
        <p className="mt-1.5 text-xs text-ink-3">
          <b className="text-success-ink">{trend}</b>
        </p>
      )}
      {spark && (
        <div className="mt-1 flex h-6 items-end gap-[3px]">
          {spark.map((v, i) => (
            <span
              key={i}
              className={
                "w-[7px] rounded-[2.5px] " +
                (i === spark.length - 1 ? "bg-primary" : "bg-primary-soft-2")
              }
              style={{ height: `${Math.max(20, ((v - 90) / 10) * 100)}%` }}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
