"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, Users } from "lucide-react";
import { useState } from "react";
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
import { currentSession } from "@/lib/session";
import type { MemberRole } from "@/lib/types";

const WEEK = currentWeek();

/**
 * The windows the filter offers.
 *
 * "Minggu N" reads from config rather than being written out, so the pills
 * stay true when the school rolls its calendar over. Clamped at 1: during
 * week 1 the previous-week pill is the same window as the first, and saying
 * so beats offering a week that does not exist.
 */
const RANGES = [
  { key: "now", label: `Minggu ${WEEK}`, first: WEEK, last: WEEK },
  {
    key: "prev",
    label: `Minggu ${Math.max(1, WEEK - 1)}`,
    first: Math.max(1, WEEK - 1),
    last: Math.max(1, WEEK - 1),
  },
  { key: "four", label: "4 minggu", first: Math.max(1, WEEK - 3), last: WEEK },
  { key: "session", label: "Sepanjang sesi", first: 1, last: WEEK },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

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
  /** Sent back this session, and how many of those are approved now. */
  returned: number;
  fixed: number;
  last: string;
}

/**
 * How badly a teacher needs a supervisor's attention, lowest first.
 *
 * "Tiada" outranks "Lewat": a week with no plan at all is further from done
 * than one that exists but has not been sealed, and both are further than
 * "Menunggu", which is simply a plan waiting on somebody else.
 */
const SEVERITY: Record<Row["week"], number> = { Tiada: 0, Lewat: 1, Menunggu: 2, Lengkap: 3 };

const bySeverity = (a: Row, b: Row) =>
  SEVERITY[a.week] - SEVERITY[b.week] ||
  a.compliance - b.compliance ||
  // Stable tiebreak, so the list does not reshuffle between renders.
  a.name.localeCompare(b.name);

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
    returned: r.returnedTotal,
    fixed: r.fixedTotal,
    last: r.lastReviewedAt ? shortDate(r.lastReviewedAt) : "-",
  };
}

export default function SekolahPage() {
  // The filter. Keyed rather than by label so the pills can be reworded
  // without the state silently pointing at the wrong window.
  const [rangeKey, setRangeKey] = useState<RangeKey>("now");
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];
  const scope =
    range.first === range.last ? `Minggu ${range.last}` : `Minggu ${range.first}–${range.last}`;

  // school_week_stats RPC when configured, bundled demo figures otherwise.
  // The range goes to the server rather than filtering client-side: the
  // history is fetched by window, and a client-side slice would show weeks
  // that were never asked for.
  const s = useSchoolStats({ first: range.first, last: range.last });
  // Floor of 1: an empty history would otherwise leave maxPct at 0 and every
  // bar at NaN height.
  const maxPct = Math.max(1, ...s.weeks.map((w) => w.compliance ?? 0));

  // Gated on `pantau`, and narrowed again inside erph.pantau_teachers to the
  // teachers this reviewer actually supervises — so a GPK's table is their
  // own teachers and nobody else's, while the aggregate cards above stay
  // school-wide for both roles. Same window as the cards: a roster for one
  // week under a total for four is a table that contradicts its own header.
  const teachers = useQuery<{ items: TeacherRow[] }>({
    queryKey: ["pantau-teachers", range.first, range.last],
    queryFn: async () => {
      const res = await fetch(`/api/pantau/teachers?first=${range.first}&last=${range.last}`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: TeacherRow[] };
    },
    enabled: supabaseConfigured,
    retry: false,
  });

  const roster: Row[] = supabaseConfigured
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
        // The bundled rows carry no review history, so the pair is shown as
        // absent rather than as a teacher who was never sent anything back.
        returned: 0,
        fixed: 0,
        last: t.last,
      }));

  // Worst first. `pantau_teachers` returns them alphabetically, which is the
  // one order that makes a supervisor read all forty rows to find the three
  // that need them — and the three that need them are the three at the top of
  // a supervisor's mind, not the top of the alphabet.
  const rows = [...roster].sort(bySeverity);

  // Not "not submitted" — "Lewat" means their plan exists but is not approved,
  // and "Tiada" means this week has nothing at all. Both need a nudge; neither
  // is the same as a teacher who is simply mid-task, which is Menunggu.
  const lateCount = rows.filter((r) => r.week === "Lewat" || r.week === "Tiada").length;
  // Computed from the same rows the table below renders. Anything else here
  // would be a bundled demo figure presented as the school's own.
  const done = rows.length - lateCount;
  const pct = rows.length === 0 ? 0 : Math.round((done / rows.length) * 100);

  // A trend is two measurements. With only one there is nothing to compare,
  // so the card says nothing rather than inventing a direction — the
  // "▼ 2.1 minit sejak guna templat" it replaced was a constant, and it
  // attributed the change to a feature rather than to a clock.
  const trendLabel =
    s.avgMinutes === null || s.prevAvgMinutes === null
      ? undefined
      : (() => {
          const delta = s.prevAvgMinutes - s.avgMinutes;
          if (Math.abs(delta) < 0.05) return "tanpa perubahan";
          return `${delta > 0 ? "▼" : "▲"} ${Math.abs(delta).toFixed(1)} minit vs minggu lepas`;
        })();

  // The trend the chart beside it actually shows. A fixed "▲ 6% sejak M1"
  // badge sat here while the bars changed underneath it, so on any school
  // whose session was flat or falling it still claimed an improvement — and
  // it did so next to a chart that plainly said otherwise.
  const firstWeek = s.weeks[0];
  const lastWeek = s.weeks[s.weeks.length - 1];
  const sessionTrend =
    firstWeek && lastWeek && firstWeek.compliance !== null && lastWeek.compliance !== null
      ? lastWeek.compliance - firstWeek.compliance
      : null;

  /**
   * Nudge the teachers who are late.
   *
   * The server decides who that is and reports how many it reached. Both
   * buttons used to print a count the client had guessed — "3 peringatan
   * dihantar" — and send nothing, so a Guru Besar was told their staff had
   * been reminded while the staff heard nothing at all. Reporting the
   * server's number also means a second tap against the same week says
   * "tiada guru perlu diberi peringatan" rather than claiming a second round.
   */
  const remind = async (targets?: string[]) => {
    if (!supabaseConfigured) {
      toast("Peringatan hanya boleh dihantar dalam mod tersegerak.");
      return;
    }
    try {
      const res = await fetch("/api/reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(targets ? { targets } : {}),
      });
      const out = (await res.json()) as { notified?: number; error?: string };
      if (!res.ok) throw new Error(out.error ?? "Gagal menghantar peringatan.");
      toast.success(
        out.notified
          ? `Peringatan dihantar kepada ${out.notified} guru.`
          : "Tiada guru yang perlu diberi peringatan.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghantar peringatan.");
    }
  };

  return (
    <>
      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              // Reflects which window is actually loaded. This was hardcoded to
              // the first pill, so the filter always *looked* set to "Minggu N"
              // whether or not anything had been chosen — and clicking did
              // nothing at all.
              aria-pressed={rangeKey === r.key}
              onClick={() => setRangeKey(r.key)}
              className={
                "rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors " +
                (rangeKey === r.key
                  ? "border-ink bg-ink text-surface"
                  : "border-border-strong bg-surface text-ink-2 hover:bg-surface-3")
              }
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="ml-auto flex gap-2">
          {/* Deliberately not disabled off the roster's count. A reminder is
              always about the *current* week, and lateCount now describes
              whichever window is loaded — so a "Sepanjang sesi" view would
              enable a button about a week nobody is late in, and a single-week
              view would silence one where someone is. The server decides and
              reports how many it reached. */}
          <Button size="sm" onClick={() => void remind()}>
            <Bell className="h-4 w-4" strokeWidth={1.9} aria-hidden /> Hantar peringatan
          </Button>
        </span>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Guru aktif"
          value={String(s.activeTeachers)}
          sub="guru biasa berdaftar"
          icon={<Users className="h-4 w-4" />}
        />
        <Stat
          // Follows the window. "RPH minggu ini" beside a four-week total is
          // the same lie the fixed badge was — a label describing one thing
          // over a number describing another.
          label={`RPH · ${scope}`}
          value={String(s.submitted)}
          sub={` · ${s.approved} diluluskan`}
          bar={s.submitted === 0 ? 0 : (s.approved / s.submitted) * 100}
        />
        <Stat
          label="Kadar pematuhan"
          value={String(s.compliancePct)}
          sub="%"
          spark={s.weeks.map((w) => w.compliance ?? 0)}
        />
        <Stat
          label={range.first === range.last ? "Purata masa siap" : "Purata mingguan"}
          value={s.avgMinutes === null ? "—" : String(s.avgMinutes)}
          // A weekly mean over a window, not the average plan — the RPC
          // returns a per-week figure and nothing to weight it by.
          sub={range.first === range.last ? " minit" : " minit / minggu"}
          // Stated only when both windows have a figure. A trend is two
          // measurements; anything less is a number someone chose.
          trend={trendLabel}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_348px]">
        {/* ── Chart ──────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Penghantaran mengikut minggu</CardTitle>
            <CardDescription>
              Sesi {currentSession()} · {scope}
            </CardDescription>
            <span className="ml-auto">
              {sessionTrend === null ? null : Math.abs(sessionTrend) < 0.05 ? (
                <Badge variant="neutral">Tanpa perubahan sejak M{firstWeek?.week}</Badge>
              ) : (
                <Badge variant={sessionTrend > 0 ? "success" : "danger"}>
                  {sessionTrend > 0 ? "▲" : "▼"} {Math.abs(sessionTrend).toFixed(0)}% sejak M
                  {firstWeek?.week}
                </Badge>
              )}
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
                  <span className="num text-[10.5px] font-bold text-ink-3">
                    {w.compliance ?? 0}%
                  </span>
                  <span
                    className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-md shadow-xs"
                    style={{ height: `${((w.compliance ?? 0) / maxPct) * 78}%` }}
                  >
                    <span style={{ height: `${w.compliance ?? 0}%`, background: "#12b76a" }} />
                    <span
                      style={{ height: `${100 - (w.compliance ?? 0)}%`, background: "#f04438" }}
                    />
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

        {/* ── Progress ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Kemajuan · {scope}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Derived from the rows in the table below. The card this
                replaces was titled "Mengikut bidang" and showed Prasekolah,
                Sekolah Rendah and Sekolah Menengah at 100 / 95 / 88 percent —
                bundled demo figures that no query ever overrode, describing
                groupings this school does not hold, and addressing a Guru
                Besar as "bidang anda" when they oversee the whole school. */}
            <div>
              <div className="mb-1.5 flex justify-between border-none p-0 text-[13px]">
                <span className="text-ink-3">RPH lengkap</span>
                <span className="num font-bold">
                  {done} / {rows.length}
                </span>
              </div>
              <Progress value={pct} tone={pct >= 95 ? "success" : "warning"} />
            </div>
            <div className="flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft p-3 text-[12.5px] leading-[1.55] text-info-ink">
              <Bell className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
              <div>
                {lateCount > 0 ? (
                  <>
                    {lateCount} guru belum lengkap dalam tempoh ini. Peringatan sentiasa merujuk{" "}
                    <b>minggu semasa</b> — itulah yang perlu dibereskan.
                  </>
                ) : (
                  <>Semua guru di bawah seliaan anda lengkap untuk {scope.toLowerCase()}.</>
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
                {/* Follows the loaded window. The roster counts the same weeks the
              cards do, so a header naming one week over a total for four would
              be the mismatch the range filter was fixed to remove. */}
                <TH>{scope}</TH>
                <TH>Pematuhan sesi</TH>
                <TH>Dikembalikan → dibetulkan</TH>
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
                  <TD>
                    {/* Of the plans sent back, how many are approved now. The
                        pair is what separates a teacher who acts on feedback
                        from one who does not — a count of who is *currently*
                        returned cannot, because a teacher who fixes everything
                        and one who ignores every return look identical once
                        the first is caught up. Absent when nothing has ever
                        been returned, rather than a flat 0/0. */}
                    {t.returned === 0 ? (
                      <span className="text-[12.5px] text-ink-4">—</span>
                    ) : (
                      <span className="num text-[12.5px]">
                        {t.fixed} / {t.returned}
                        {t.fixed < t.returned && (
                          <span className="ml-1 text-danger-ink">
                            ({t.returned - t.fixed} belum)
                          </span>
                        )}
                      </span>
                    )}
                  </TD>
                  <TD className="num text-[12.5px] text-ink-3">{t.last}</TD>
                  <TD className="text-right">
                    {/* Offered only where it does something. A teacher who is
                        up to date has nothing to nudge, and the branch this
                        replaced printed a toast about calling up their plans
                        and fetched nothing — so the control is absent rather
                        than present and inert. */}
                    {(t.week === "Lewat" || t.week === "Tiada") && (
                      <Button size="sm" variant="ghost" onClick={() => void remind([t.id])}>
                        Peringat
                      </Button>
                    )}
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
