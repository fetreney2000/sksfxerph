"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/rph/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
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
import { weekExists } from "@/lib/config";
import { longDateOf, schoolDays, weekRangeLabel } from "@/lib/date";
import { useCurrentWeek } from "@/lib/hooks/use-calendar";
import { useSession } from "@/lib/hooks/use-session";
import { useArchive } from "@/lib/hooks/use-week";
import type { RphDocument } from "@/lib/types";

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
  const [confirming, setConfirming] = React.useState<RphDocument | null>(null);
  const [busy, setBusy] = React.useState(false);

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
            <Card key={s} className="overflow-hidden">
              <div>
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
                      return (
                        <div key={key}>
                          <div
                            className={cn(
                              "flex items-center gap-1 rounded-[10px] transition-colors",
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
                                      </div>
                                      <StatusBadge
                                        status={d.status}
                                        grade={d.grade}
                                        className="hidden shrink-0 sm:inline-flex"
                                      />
                                      <div className="flex shrink-0 items-center">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => router.push(`/editor/${d.id}`)}
                                        >
                                          Buka
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          aria-label={`Salin ${d.classNames.join(", ")} ${d.subjectName} ${d.planDate}`}
                                          onClick={() => router.push(`/editor?copy=${d.id}`)}
                                        >
                                          <Copy
                                            className="h-3.5 w-3.5"
                                            strokeWidth={1.9}
                                            aria-hidden
                                          />
                                          Salin
                                        </Button>
                                        {/* Only working copies can be withdrawn: a filed
                                            plan is under review or sealed, and the
                                            server refuses those with a 409. */}
                                        {(d.status === "draft" || d.status === "returned") && (
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            aria-label={`Padam ${d.classNames.join(", ")} ${d.subjectName} ${d.planDate}`}
                                            onClick={() => setConfirming(d)}
                                          >
                                            <Trash2
                                              className="h-3.5 w-3.5"
                                              strokeWidth={1.9}
                                              aria-hidden
                                            />
                                          </Button>
                                        )}
                                      </div>
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

      <Card className="mt-3">
        <CardFooter>
          <span className="text-[12.5px] text-ink-3">
            Rekod disimpan mengikut Peraturan 8, Akta Pendidikan 1996 - memadam menyembunyikan
            rancangan daripada aplikasi, tetapi rekod kekal dalam pangkalan data.
          </span>
        </CardFooter>
      </Card>

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
              Rancangan ini tidak akan dipaparkan dalam arkib, papan pemuka mahupun laporan.
              <b className="text-ink-2"> Rekod kekal disimpan</b> mengikut Peraturan 8, Akta
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
    </>
  );
}
