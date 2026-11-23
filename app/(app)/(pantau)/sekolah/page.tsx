"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, Clock3, ExternalLink, Users } from "lucide-react";
import { useState } from "react";
import type { TeacherRow } from "@/app/api/pantau/teachers/route";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HelpHint } from "@/components/ui/help-hint";
import { Progress } from "@/components/ui/progress";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { supabaseConfigured } from "@/lib/config";
import { formatMyt } from "@/lib/date";
import { useCurrentWeek } from "@/lib/hooks/use-calendar";
import { useSchoolStats } from "@/lib/hooks/use-remote";
import { useSession } from "@/lib/hooks/use-session";
import { ms } from "@/lib/i18n/ms";
import type { MemberRole } from "@/lib/types";

type RangeKey = "now" | "prev" | "four" | "session";

/** These counts describe recorded plans, not a teacher's deadline or workload. */
function approvalState(total: number, approved: number) {
  if (total === 0) return { label: "Tiada RPH", tone: "neutral" as const };
  if (approved === total) return { label: "Semua disahkan", tone: "success" as const };
  if (approved === 0) return { label: "Belum disahkan", tone: "warning" as const };
  return { label: "Sebahagian disahkan", tone: "info" as const };
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function shortDate(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return formatMyt({
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function SekolahPage() {
  const week = useCurrentWeek();
  const session = useSession();
  const [rangeKey, setRangeKey] = useState<RangeKey>("now");
  const ranges: { key: RangeKey; label: string; first: number; last: number }[] = [
    { key: "now", label: `Minggu ${week}`, first: week, last: week },
    ...(week > 1
      ? [{ key: "prev" as const, label: `Minggu ${week - 1}`, first: week - 1, last: week - 1 }]
      : []),
    { key: "four", label: "4 minggu terkini", first: Math.max(1, week - 3), last: week },
    { key: "session", label: "Sesi hingga kini", first: 1, last: week },
  ];
  const range = ranges.find((r) => r.key === rangeKey) ?? {
    key: "now" as const,
    label: `Minggu ${week}`,
    first: week,
    last: week,
  };
  const scope =
    range.first === range.last ? `Minggu ${range.last}` : `Minggu ${range.first}–${range.last}`;
  const stats = useSchoolStats({ first: range.first, last: range.last });
  const teachers = useQuery<{ items: TeacherRow[] }>({
    queryKey: ["pantau-teachers", session, range.first, range.last],
    queryFn: async () => {
      const res = await fetch(`/api/pantau/teachers?first=${range.first}&last=${range.last}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Gagal memuatkan senarai guru.");
      return (await res.json()) as { items: TeacherRow[] };
    },
    enabled: supabaseConfigured,
    retry: false,
  });
  const rows = teachers.data?.items ?? [];
  const allApproved = rows.filter((r) => r.weekTotal > 0 && r.weekDone === r.weekTotal).length;
  const noPlans = rows.filter((r) => r.weekTotal === 0).length;
  const partlyApproved = rows.filter((r) => r.weekDone > 0 && r.weekDone < r.weekTotal).length;
  const awaitingApproval = rows.filter((r) => r.weekTotal > 0 && r.weekDone === 0).length;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-gradient-to-r from-primary-soft/60 to-surface px-5 py-5 sm:px-6">
          <div>
            <p className="text-[11px] font-bold tracking-[0.12em] text-primary-ink uppercase">
              Penyeliaan sekolah
            </p>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight">Paparan Sekolah</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-3">
              Ringkasan sekolah dan status RPH guru dalam skop penyeliaan anda.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface px-4 py-2 text-right">
            <p className="text-[11px] font-semibold text-ink-4">Sesi</p>
            <p className="num text-sm font-bold">{session}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 sm:px-6">
          <span className="mr-1 text-xs font-semibold text-ink-3">Tempoh</span>
          {ranges.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range.key === r.key}
              onClick={() => setRangeKey(r.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${range.key === r.key ? "border-ink bg-ink text-surface" : "border-border bg-surface text-ink-2 hover:bg-surface-2"}`}
            >
              {r.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-ink-4">{scope}</span>
        </div>
      </section>

      {!supabaseConfigured && (
        <div className="rounded-xl border border-info-line bg-info-soft px-4 py-3 text-sm text-info-ink">
          Mod setempat: angka sekolah ialah data contoh. Senarai guru sebenar memerlukan
          pangkalan data.
        </div>
      )}
      {stats.error && (
        <div
          role="alert"
          className="rounded-xl border border-danger-line bg-danger-soft p-4 text-sm text-danger-ink"
        >
          Statistik sekolah tidak dapat dimuatkan. Sila cuba semula.
        </div>
      )}
      {!stats.error && stats.loading && (
        <p className="py-4 text-sm text-ink-3">Memuatkan statistik sekolah…</p>
      )}
      {!stats.error && !stats.loading && (
        <>
          <section aria-label="Ringkasan sekolah">
            <div className="mb-3 flex items-end justify-between gap-2">
              <div>
                <h2 className="font-bold">Ringkasan seluruh sekolah</h2>
                <p className="text-xs text-ink-3">{scope} · semua RPH sekolah</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                icon={<Users className="h-4 w-4" />}
                label="Guru biasa aktif"
                value={String(stats.activeTeachers)}
                description="Bilangan guru biasa aktif sekarang"
              />
              <Metric
                icon={<BarChart3 className="h-4 w-4" />}
                label="RPH bukan draf"
                value={String(stats.submitted)}
                description={`${stats.approved} telah disahkan · termasuk RPH yang dikembalikan`}
              />
              <Metric
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Pematuhan anggaran"
                value={stats.compliancePct === null ? "—" : `${stats.compliancePct}%`}
                description={
                  stats.expected === 0
                    ? "Tiada sasaran untuk dikira"
                    : `${stats.approved} disahkan / ${stats.expected} sasaran · maksimum 100%`
                }
              />
              <Metric
                icon={<Clock3 className="h-4 w-4" />}
                label={
                  range.first === range.last
                    ? "Purata masa semakan"
                    : "Purata masa semakan mingguan"
                }
                value={
                  stats.avgMinutes === null ? "—" : `${Number(stats.avgMinutes.toFixed(1))} min`
                }
                description={
                  range.first === range.last
                    ? "Dari penghantaran hingga keputusan"
                    : "Purata tidak berwajaran bagi minggu yang mempunyai keputusan"
                }
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-4">
              Sasaran = guru biasa yang aktif sekarang × tetapan RPH seminggu × bilangan minggu.
              Bilangan RPH merangkumi semua pemilik di sekolah, termasuk GPK; keahlian dan
              tetapan semasa juga digunakan untuk minggu terdahulu.
            </p>
          </section>

          <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Pematuhan mengikut minggu</CardTitle>
                  <CardDescription>
                    {scope} · disahkan berbanding sasaran, dihadkan kepada 100%
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {stats.weeks.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-4">
                    Tiada data untuk tempoh ini.
                  </p>
                ) : (
                  <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                    {stats.weeks.map((w) => (
                      <div
                        key={w.week}
                        className="grid grid-cols-[48px_1fr_58px] items-center gap-3 text-xs"
                      >
                        <span className="font-semibold text-ink-3">M{w.week}</span>
                        {w.compliance === null ? (
                          <span className="h-1 rounded-full bg-surface-2" />
                        ) : (
                          <Progress value={w.compliance} tone="success" />
                        )}
                        <span className="num text-right font-bold">
                          {w.compliance === null ? "—" : `${w.compliance}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Status guru dalam skop</CardTitle>
                  <CardDescription>Berdasarkan RPH yang direkodkan · {scope}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {!supabaseConfigured ? (
                  <p className="text-sm text-ink-4">Tidak tersedia dalam mod setempat.</p>
                ) : teachers.isLoading ? (
                  <p className="text-sm text-ink-4">Memuatkan…</p>
                ) : teachers.isError ? (
                  <p role="alert" className="text-sm text-danger-ink">
                    Senarai guru tidak dapat dimuatkan.
                  </p>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-ink-4">Tiada guru dalam skop penyeliaan.</p>
                ) : (
                  <div className="space-y-3">
                    <SummaryRow label="Semua RPH disahkan" value={allApproved} />
                    <SummaryRow label="Sebahagian disahkan" value={partlyApproved} />
                    <SummaryRow label="Belum ada yang disahkan" value={awaitingApproval} />
                    <SummaryRow label="Tiada RPH direkodkan" value={noPlans} />
                    <p className="border-t border-border pt-3 text-xs leading-relaxed text-ink-4">
                      Status membandingkan RPH yang disahkan dengan RPH yang direkodkan, bukan
                      jumlah yang sepatutnya disediakan.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-bold">RPH mengikut guru</h2>
            <p className="mt-1 text-xs text-ink-3">Guru dalam skop akaun anda · {scope}</p>
          </div>
          {supabaseConfigured && teachers.data && (
            <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-ink-3">
              {rows.length} guru
            </span>
          )}
        </div>
        <Card>
          {!supabaseConfigured ? (
            <CardContent className="py-8 text-center text-sm text-ink-4">
              Senarai guru tidak tersedia dalam mod setempat.
            </CardContent>
          ) : teachers.isLoading ? (
            <CardContent className="py-8 text-center text-sm text-ink-4">
              Memuatkan senarai guru…
            </CardContent>
          ) : teachers.isError ? (
            <CardContent role="alert" className="py-8 text-center text-sm text-danger-ink">
              Senarai guru tidak dapat dimuatkan. Sila cuba semula.
            </CardContent>
          ) : rows.length === 0 ? (
            <CardContent className="py-8 text-center text-sm text-ink-4">
              Tiada guru dalam skop penyeliaan.
            </CardContent>
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <tr>
                    <TH>Guru</TH>
                    <TH>Kelas dalam sesi</TH>
                    <TH>Status · {scope}</TH>
                    <TH>
                      Disahkan · sesi{" "}
                      <HelpHint label="RPH yang disahkan dalam sesi">
                        Peratus RPH yang disahkan daripada semua RPH guru yang direkodkan dalam
                        sesi ini, termasuk draf. Bukan peratus sasaran sekolah.
                      </HelpHint>
                    </TH>
                    <TH>
                      Pernah dikembalikan → disahkan{" "}
                      <HelpHint label="Sejarah pengembalian">
                        Bilangan RPH yang pernah dikembalikan dan, daripadanya, bilangan yang
                        pernah menerima keputusan untuk mengesahkan. Keputusan terkini mungkin
                        berbeza.
                      </HelpHint>
                    </TH>
                    <TH>Semakan terakhir · sesi</TH>
                    <TH>RPT · sesi</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((teacher) => {
                    const state = approvalState(teacher.weekTotal, teacher.weekDone);
                    const percentage =
                      teacher.sessionTotal === 0
                        ? null
                        : Math.round((teacher.sessionDone / teacher.sessionTotal) * 100);
                    return (
                      <TR key={teacher.userId}>
                        <TD>
                          <div className="flex items-center gap-2.5">
                            <Avatar initials={initials(teacher.fullName)} tone="blue" small />
                            <div>
                              <div className="font-semibold">{teacher.fullName}</div>
                              <div className="text-xs text-ink-4">
                                {ms.roles[teacher.role as MemberRole] ?? teacher.role}
                              </div>
                            </div>
                          </div>
                        </TD>
                        <TD className="text-ink-3">{teacher.classes ?? "—"}</TD>
                        <TD>
                          <Badge variant={state.tone}>{state.label}</Badge>
                          <p className="num mt-1 text-xs text-ink-4">
                            {teacher.weekDone} / {teacher.weekTotal} RPH
                          </p>
                        </TD>
                        <TD>
                          {percentage === null ? (
                            <span className="text-ink-4">—</span>
                          ) : (
                            <div className="min-w-28">
                              <div className="mb-1 flex justify-between gap-2 text-xs">
                                <span className="num">
                                  {teacher.sessionDone} / {teacher.sessionTotal}
                                </span>
                                <b className="num">{percentage}%</b>
                              </div>
                              <Progress value={percentage} tone="success" />
                            </div>
                          )}
                        </TD>
                        <TD className="num">
                          {teacher.returnedTotal === 0
                            ? "—"
                            : `${teacher.returnedTotal} → ${teacher.fixedTotal}`}
                        </TD>
                        <TD className="num text-xs text-ink-3">
                          {shortDate(teacher.lastReviewedAt)}
                        </TD>
                        <TD>
                          {teacher.rptLinks.length === 0 ? (
                            <span className="text-ink-4">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {teacher.rptLinks.map((link) => (
                                <a
                                  key={`${link.title}:${link.url}`}
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex max-w-40 items-center gap-1 rounded-full border border-border px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-2"
                                >
                                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                                  <span className="truncate">{link.title}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      </section>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-3">{label}</span>
        <span
          className="grid h-9 w-9 place-items-center rounded-xl bg-primary-soft text-primary-ink"
          aria-hidden
        >
          {icon}
        </span>
      </div>
      <p className="num mt-3 text-[27px] font-extrabold tracking-tight">{value}</p>
      <p className="mt-1 min-h-8 text-xs leading-relaxed text-ink-4">{description}</p>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-ink-3">{label}</span>
      <span className="num font-bold">{value}</span>
    </div>
  );
}
