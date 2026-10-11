"use client";

import { Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/rph/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
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
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { removePlan } from "@/lib/actions/plans";
import { currentWeek } from "@/lib/config";
import { longDateOf, schoolDays, weekRangeLabel } from "@/lib/date";
import { useArchive } from "@/lib/hooks/use-week";
import type { RphDocument } from "@/lib/types";

export default function ArkibPage() {
  const router = useRouter();
  const archive = useArchive() ?? [];
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
        [d.className, d.subjectName, d.payload.tajuk, d.payload.standard_kandungan].some((f) =>
          f.toLowerCase().includes(needle),
        ),
      )
    : archive;

  /**
   * The flat list is a year of teaching — a full-time teacher is past a
   * hundred plans by December — and it used to render every one of them at
   * once. The newest page is what anyone opening this screen wants; the rest
   * is one press away, and searching starts the window again from the top.
   */
  const PAGE = 20;
  const [shown, setShown] = React.useState(PAGE);
  React.useEffect(() => setShown(PAGE), [needle]);
  const visible = docs.slice(0, shown);

  const byWeek = new Map<number, typeof docs>();
  for (const d of docs) {
    const list = byWeek.get(d.weekNo) ?? [];
    list.push(d);
    byWeek.set(d.weekNo, list);
  }

  /**
   * Every week that has happened, not only the weeks with plans in them.
   *
   * A week with nothing filed under it used not to appear here at all, which
   * made the one week a teacher most needs to see — the one they missed — the
   * one the archive hid. It is now a row like any other, empty and with a way
   * to fill it in.
   *
   * While searching, only the weeks that match: a list of empty rows beside a
   * result is noise.
   */
  const now = currentWeek();
  const past = Array.from({ length: Math.max(0, now - 1) }, (_, i) => now - 1 - i);
  const weeks = needle
    ? [...byWeek.keys()].sort((a, b) => b - a)
    : [...new Set([...byWeek.keys(), ...past])].sort((a, b) => b - a);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Arkib mengikut minggu</h2>
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
            placeholder="Cari kelas, subjek atau tajuk…"
            aria-label="Cari dalam arkib"
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>Minggu</TH>
                <TH>Tarikh</TH>
                <TH>RPH dihantar</TH>
                <TH>Status semakan</TH>
                <TH>Disemak</TH>
                <TH className="text-right">Tindakan</TH>
              </tr>
            </THead>
            <TBody>
              {weeks.length === 0 && (
                <tr>
                  <TD colSpan={6} className="py-10 text-center text-ink-4">
                    {/* Different message, because it is a different situation.
                        "Belum ada rekod" tells a teacher they have written
                        nothing; saying that to someone whose search simply
                        matched nothing reads as a lost year. */}
                    {needle ? `Tiada RPH sepadan dengan "${q.trim()}".` : "Belum ada rekod."}
                  </TD>
                </tr>
              )}
              {weeks.map((w) => {
                const rows = byWeek.get(w) ?? [];
                // The week's most recent review. Name and date come from the
                // same document, so the pair describes one decision rather
                // than one person's name beside another's date.
                const newest = rows
                  .filter((r) => typeof r.reviewedAt === "number")
                  .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0))[0];
                const reviewed = newest?.reviewedAt;
                const reviewer = newest?.reviewerName;
                const approved = rows.filter((r) => r.status === "approved").length;
                const returned = rows.filter((r) => r.status === "returned").length;
                const submitted = rows.filter((r) => r.status !== "draft").length;
                const range = schoolDays(w);

                return (
                  <TR key={w}>
                    <TD>
                      <b className="num">Minggu {w}</b>
                    </TD>
                    <TD className="num whitespace-nowrap text-ink-3">
                      {range[0] ? weekRangeLabel(w) : "—"}
                    </TD>
                    <TD className="num">
                      {rows.length === 0 ? (
                        <span className="text-ink-4">0 / 0</span>
                      ) : (
                        `${submitted} / ${rows.length}`
                      )}
                    </TD>
                    <TD>
                      {rows.length === 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-3">
                          Belum ada RPH
                        </span>
                      ) : approved === rows.length && rows.length > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-success-line bg-success-soft px-2.5 py-[3px] text-[11.5px] font-semibold text-success-ink">
                          Lengkap semua (1)
                        </span>
                      ) : returned > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-danger-line bg-danger-soft px-2.5 py-[3px] text-[11.5px] font-semibold text-danger-ink">
                          {returned} tidak lengkap (0)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-warning-line bg-warning-soft px-2.5 py-[3px] text-[11.5px] font-semibold text-warning-ink">
                          Dalam semakan
                        </span>
                      )}
                    </TD>
                    <TD>
                      {/* Name and date from the same document — the week's
                          most recent review. The reviewer is whoever wrote the
                          newest `rph_review` row, which for a plan returned
                          and then approved is the approver. */}
                      {rows.length === 0 ? (
                        <span className="text-[12.5px] text-ink-4">—</span>
                      ) : reviewer || reviewed ? (
                        <div className="min-w-0">
                          {reviewer && (
                            <span className="block truncate text-[12.5px] font-semibold text-ink">
                              {reviewer}
                            </span>
                          )}
                          {reviewed && (
                            <span className="num block text-[11px] text-ink-4">
                              {longDateOf(reviewed)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[12.5px] text-ink-4">Belum disemak</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        {rows.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const first = rows[0];
                              if (first) router.push(`/editor/${first.id}`);
                            }}
                          >
                            Buka
                          </Button>
                        )}
                        {/* The way a missed week gets filled in: the penyunting
                            opens already filed under this one, so the RPH is
                            written for the lessons that were actually missed
                            rather than for whatever week happens to be current. */}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => router.push(`/editor?week=${w}`)}
                        >
                          Tambah RPH
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>

        <CardFooter>
          <span className="text-[12.5px] text-ink-3">
            Rekod disimpan mengikut Peraturan 8, Akta Pendidikan 1996 — memadam menyembunyikan
            rancangan daripada aplikasi, tetapi rekod kekal dalam pangkalan data.
          </span>
        </CardFooter>
      </Card>

      {/* Individual plans, most recent first */}
      <div className="mt-6 mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Semua RPH</h2>
        <span className="h-px flex-1 bg-border" />
        <span className="num text-xs text-ink-3">
          {/* "N daripada M" while filtering. A bare filtered count reads as
              the size of the archive, and a teacher who searched for one
              lesson would conclude they have three plans in a year. */}
          {needle ? `${docs.length} daripada ${archive.length} rekod` : `${docs.length} rekod`}
        </span>
      </div>

      <Card>
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>Tarikh</TH>
                <TH>Kelas · Subjek</TH>
                <TH>Standard Kandungan</TH>
                <TH>Status</TH>
                <TH className="text-right">Tindakan</TH>
              </tr>
            </THead>
            <TBody>
              {visible.map((d) => (
                <TR key={d.id}>
                  <TD className="num whitespace-nowrap">{d.planDate}</TD>
                  <TD>
                    <div className="font-semibold">
                      {d.className} · {d.subjectName}
                    </div>
                  </TD>
                  <TD>
                    <span className="ellip block max-w-[280px] text-ink-3">
                      {d.payload.standard_kandungan || "—"}
                    </span>
                  </TD>
                  <TD>
                    <StatusBadge status={d.status} grade={d.grade} />
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
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
                        aria-label={`Padam ${d.className} ${d.subjectName} ${d.planDate}`}
                        onClick={() => setConfirming(d)}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
              {docs.length === 0 && (
                <tr>
                  <TD colSpan={5} className="py-10 text-center text-ink-4">
                    {needle
                      ? `Tiada RPH sepadan dengan "${q.trim()}".`
                      : "Belum ada RPH. Mulakan daripada Minggu Ini."}
                  </TD>
                </tr>
              )}
            </TBody>
          </Table>
        </TableContainer>

        {/* Stated rather than implied: a teacher who has written eighty plans
            sees twenty of them and is told there are eighty, so scrolling to
            the bottom is a choice rather than a surprise. */}
        {docs.length > 0 && (
          <CardFooter>
            <span className="text-[12.5px] text-ink-3">
              Menunjukkan {visible.length} daripada {docs.length} rekod
            </span>
            {docs.length > visible.length && (
              <Button
                className="ml-auto"
                size="sm"
                variant="secondary"
                onClick={() => setShown((n) => n + PAGE)}
              >
                Tunjuk lagi {Math.min(PAGE, docs.length - visible.length)}
              </Button>
            )}
          </CardFooter>
        )}
      </Card>

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keluarkan rancangan daripada arkib?</DialogTitle>
            <DialogDescription>
              {confirming
                ? `${confirming.className} · ${confirming.subjectName} · ${confirming.planDate}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {/* The distinction the footer promises, spelled out at the moment
                it matters: "gone from the app" and "gone from the record" are
                not the same thing, and only one of them is happening. */}
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
