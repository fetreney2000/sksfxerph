"use client";

import { Download, Trash2 } from "lucide-react";
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
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { removePlan } from "@/lib/actions/plans";
import { longDate, schoolDays, weekRangeLabel } from "@/lib/date";
import { useArchive } from "@/lib/hooks/use-week";
import type { RphDocument } from "@/lib/types";

export default function ArkibPage() {
  const router = useRouter();
  const docs = useArchive() ?? [];
  const [confirming, setConfirming] = React.useState<RphDocument | null>(null);
  const [busy, setBusy] = React.useState(false);

  const byWeek = new Map<number, typeof docs>();
  for (const d of docs) {
    const list = byWeek.get(d.weekNo) ?? [];
    list.push(d);
    byWeek.set(d.weekNo, list);
  }

  const weeks = [...byWeek.keys()].sort((a, b) => b - a);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Arkib mengikut minggu</h2>
        <span className="h-px flex-1 bg-border" />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => toast("Semua RPH sesi ini dieksport sebagai ZIP (PDF)")}
        >
          <Download className="h-4 w-4" strokeWidth={1.9} aria-hidden /> Eksport semua
        </Button>
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
                    Belum ada rekod.
                  </TD>
                </tr>
              )}
              {weeks.map((w) => {
                const rows = byWeek.get(w) ?? [];
                // Newest review in the week. Absent rather than zero when
                // nothing has been decided yet.
                const reviewed = rows
                  .map((r) => r.reviewedAt)
                  .filter((t): t is number => typeof t === "number")
                  .sort((a, b) => b - a)[0];
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
                      {submitted} / {rows.length}
                    </TD>
                    <TD>
                      {approved === rows.length && rows.length > 0 ? (
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
                      {/* The document records *when* it was reviewed, but not
                          who did it — the reviewer's name lives on the
                          signature, which is fetched per plan and is not on
                          this list query. A date is real; a name here would be
                          one the school never gave us, printed next to work it
                          may have had nothing to do with. */}
                      {reviewed ? (
                        <span className="num text-[12.5px] text-ink-2">
                          {longDate(new Date(reviewed).toISOString().slice(0, 10))}
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-ink-4">Belum disemak</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
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
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast(`Memuat turun ${rows.length} RPH (PDF)…`)}
                        >
                          PDF
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
        <span className="num text-xs text-ink-3">{docs.length} rekod</span>
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
              {docs.map((d) => (
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
                    Belum ada RPH. Mulakan daripada Minggu Ini.
                  </TD>
                </tr>
              )}
            </TBody>
          </Table>
        </TableContainer>
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
