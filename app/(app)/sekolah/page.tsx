"use client";

import { Bell, Download, Users } from "lucide-react";
import { toast } from "sonner";
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
import { currentWeek } from "@/lib/config";
import { TEACHER_ROWS } from "@/lib/demo/review";
import { useSchoolStats } from "@/lib/hooks/use-remote";

const WEEK = currentWeek();

const RANGES = ["Minggu 6", "Minggu 5", "4 minggu", "Sepanjang sesi"] as const;

export default function SekolahPage() {
  // school_week_stats RPC when configured, bundled demo figures otherwise.
  const s = useSchoolStats();
  const maxPct = Math.max(...s.weeks.map((w) => w.pct));

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
          sub=" min"
          trend="▼ 2.1 min sejak guna templat"
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
                3 guru belum menghantar. Peringatan automatik: <b>Khamis 4:00 petang</b>,
                ingatan akhir Jumaat 8:00 pagi.
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
          Memaparkan {TEACHER_ROWS.length} daripada {s.activeTeachers} guru
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
              {TEACHER_ROWS.map((t) => (
                <TR key={t.name}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={t.initials} tone={t.tone} small />
                      <div>
                        <div className="font-semibold">{t.name}</div>
                        {t.role && <div className="text-[11.5px] text-ink-3">{t.role}</div>}
                      </div>
                    </div>
                  </TD>
                  <TD className="text-ink-3">{t.panel}</TD>
                  <TD>
                    <Badge
                      variant={
                        t.week === "Lengkap"
                          ? "success"
                          : t.week === "Menunggu"
                            ? "info"
                            : "danger"
                      }
                    >
                      {t.week === "Lewat" ? "Lewat 1" : t.week}
                    </Badge>
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
                          t.week === "Lewat"
                            ? `Peringatan dihantar kepada ${t.name}`
                            : `Memanggil senarai RPH ${t.name}`,
                        )
                      }
                    >
                      {t.week === "Lewat" ? "Peringat" : "Semak"}
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
