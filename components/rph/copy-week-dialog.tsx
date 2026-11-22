"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/field";
import { copyCandidatesToWeek, type WeekCopyResult } from "@/lib/client/week-copy";
import { longDate, weekOptions } from "@/lib/date";
import { useSchoolClasses } from "@/lib/hooks/use-school-data";
import { useSession } from "@/lib/hooks/use-session";
import type { RphDocument } from "@/lib/types";
import { buildWeekCopyCandidates } from "@/lib/week-copy";

/**
 * Copy one week's RPH into another week.
 *
 * The preview is the point: dates are remapped weekday-for-weekday, Refleksi is
 * cleared, and anything that would collide with a plan already in the target
 * week is shown before a single row is written. The write itself is per-plan,
 * so a clash in the middle of the week still leaves the clean copies filed and
 * reports which ones did not go through.
 */
export function CopyWeekDialog({
  open,
  onOpenChange,
  sourceSession,
  sourceWeek,
  sourcePlans,
  archive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceSession: string;
  sourceWeek: number;
  sourcePlans: RphDocument[];
  archive: RphDocument[];
}) {
  const session = useSession();
  const queryClient = useQueryClient();
  const { items: classes } = useSchoolClasses();
  const [destination, setDestination] = React.useState<string>("");
  const [selection, setSelection] = React.useState<{ week: number; ids: Set<string> } | null>(
    null,
  );
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ week: number; rows: WeekCopyResult[] } | null>(
    null,
  );

  const destinations = React.useMemo(
    () =>
      weekOptions().filter(
        // The same number in another session is still another week; only the
        // exact source (same session, same week) is not a destination.
        (option) => !(option.week === sourceWeek && sourceSession === session),
      ),
    [sourceWeek, sourceSession, session],
  );
  const destinationWeek = Number(destination) > 0 ? Number(destination) : null;

  React.useEffect(() => {
    if (!open) return;
    setDestination(String(destinations[0]?.week ?? ""));
    setSelection(null);
    setResult(null);
    setProgress(null);
  }, [open, destinations]);

  const candidates = React.useMemo(() => {
    if (!destinationWeek) return [];
    return buildWeekCopyCandidates(
      sourcePlans,
      archive.filter(
        (plan) =>
          plan.session === session &&
          plan.weekNo === destinationWeek &&
          !sourcePlans.some((source) => source.id === plan.id),
      ),
      destinationWeek,
      classes,
    );
  }, [destinationWeek, sourcePlans, archive, session, classes]);

  const cleanIds = React.useMemo(
    () =>
      candidates
        .filter((candidate) => !candidate.blocked)
        .map((candidate) => candidate.sourceId),
    [candidates],
  );
  // The selection belongs to one destination. Changing the week recomputes the
  // default rather than carrying a set of ids that named different dates.
  const chosen =
    selection && selection.week === destinationWeek ? selection.ids : new Set(cleanIds);

  const toggle = (sourceId: string) => {
    if (!destinationWeek) return;
    const next = new Set(chosen);
    if (next.has(sourceId)) next.delete(sourceId);
    else next.add(sourceId);
    setSelection({ week: destinationWeek, ids: next });
  };

  const run = async () => {
    if (running || !destinationWeek) return;
    const picked = candidates.filter(
      (candidate) => chosen.has(candidate.sourceId) && !candidate.blocked,
    );
    if (picked.length === 0) {
      toast.info("Pilih sekurang-kurangnya satu RPH yang boleh disalin.");
      return;
    }
    setRunning(true);
    setProgress(`Menyalin 0 / ${picked.length}…`);
    try {
      const rows = await copyCandidatesToWeek(picked, session, (done, total) =>
        setProgress(`Menyalin ${done} / ${total}…`),
      );
      setResult({ week: destinationWeek, rows });
      const copied = rows.filter((row) => row.ok).length;
      const failed = rows.length - copied;
      if (copied > 0) {
        toast.success(`${copied} RPH disalin ke Minggu ${destinationWeek}.`);
        await queryClient.invalidateQueries({ queryKey: ["own-plans"] });
      }
      if (failed > 0) {
        toast.error(`${failed} RPH tidak dapat disalin. Lihat butiran di sini.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyalin minggu.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const bySource = new Map(candidates.map((candidate) => [candidate.sourceId, candidate]));
  const shown = result && result.week === destinationWeek ? result.rows : null;
  const copied = shown?.filter((row) => row.ok).length ?? 0;
  const failed = shown ? shown.length - copied : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent className="w-[min(640px,94vw)]">
        <DialogHeader>
          <DialogTitle>Salin RPH minggu {sourceWeek} ke minggu lain</DialogTitle>
          <DialogDescription>
            Sesi {sourceSession}. Setiap RPH disalin sebagai draf, tarikhnya mengikut hari yang
            sama, dan Refleksi dikosongkan - refleksi minggu asal bukan refleksi pelajaran
            baharu.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid max-h-[68vh] gap-4 overflow-y-auto">
          <div className="max-w-sm">
            <Label htmlFor="copy-week-destination" required>
              Minggu destinasi
            </Label>
            <Select
              id="copy-week-destination"
              value={destination}
              disabled={running || destinations.length === 0}
              onChange={(event) => {
                setDestination(event.target.value);
                setSelection(null);
                setResult(null);
              }}
            >
              {destinations.length === 0 && <option value="">Tiada minggu lain</option>}
              {destinations.map((option) => (
                <option key={option.week} value={option.week}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="mt-1.5 text-[11.5px] text-ink-4">
              Hanya minggu yang telah bermula boleh dipilih.
            </p>
          </div>

          {destinations.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-2 px-3 py-4 text-sm text-ink-3">
              Tiada minggu destinasi tersedia.
            </p>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[12.5px] font-semibold text-ink-2">
                RPH yang akan disalin
              </legend>
              {candidates.length === 0 && (
                <p className="text-sm text-ink-4">Tiada RPH dalam minggu ini.</p>
              )}
              {candidates.map((candidate) => {
                const blocked = candidate.blocked;
                return (
                  <label
                    key={candidate.sourceId}
                    className={
                      "flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2 " +
                      (blocked
                        ? "border-danger-line bg-danger-soft/40"
                        : "border-border bg-surface hover:bg-surface-2")
                    }
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!blocked && chosen.has(candidate.sourceId)}
                      disabled={blocked || running}
                      onChange={() => toggle(candidate.sourceId)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">
                        {candidate.subjectName} · {candidate.classNames.join(", ") || "—"}
                      </span>
                      <span className="num block text-[11.5px] text-ink-3">
                        {longDate(candidate.sourceDate)} → {longDate(candidate.planDate)}
                      </span>
                      {candidate.conflicts.map((conflict) => (
                        <span
                          key={conflict}
                          className="mt-1 block text-[11.5px] text-danger-ink"
                        >
                          {conflict}
                        </span>
                      ))}
                    </span>
                  </label>
                );
              })}
              <p className="text-[11.5px] leading-relaxed text-ink-4">
                RPH bertindih tidak dipilih dan tidak akan ditulis. RPH yang disalin akan muncul
                sebagai draf dalam arkib dan perlu disemak seperti biasa.
              </p>
            </fieldset>
          )}

          {progress && (
            <p role="status" className="text-sm text-ink-2">
              {progress}
            </p>
          )}

          {shown && (
            <div role="status" className="rounded-[10px] border border-border bg-surface-2 p-3">
              <p className="text-[13px] font-semibold">
                {copied} disalin
                {failed > 0 ? ` · ${failed} gagal` : ""}
              </p>
              <ul className="mt-1.5 grid gap-1 text-[12px] text-ink-3">
                {shown.map((row) => {
                  const candidate = bySource.get(row.sourceId);
                  return (
                    <li key={row.sourceId}>
                      <b className={row.ok ? "text-success-ink" : "text-danger-ink"}>
                        {row.ok ? "Disalin" : "Gagal"}
                      </b>{" "}
                      {candidate
                        ? `${candidate.subjectName} · ${candidate.planDate}`
                        : row.sourceId}
                      {row.error ? ` — ${row.error}` : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" disabled={running} onClick={() => onOpenChange(false)}>
            {shown ? "Tutup" : "Batal"}
          </Button>
          {!shown && (
            <Button
              disabled={running || !destinationWeek || chosen.size === 0}
              onClick={() => void run()}
            >
              {running ? "Menyalin…" : `Salin ${chosen.size} RPH`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
