"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus, RotateCcw } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  type CalendarRow,
  clearCalendarWeek,
  getAdminCalendar,
  setCalendarWeek,
  toAnchors,
} from "@/lib/client/admin";
import {
  type CalendarAnchor,
  setCalendarAnchors,
  weekMondayIso,
  weekOfIso,
} from "@/lib/config";
import { weekRangeLabel } from "@/lib/date";
import { useAdminSave } from "@/lib/hooks/use-admin-save";
import { useCurrentWeek } from "@/lib/hooks/use-calendar";

/**
 * Tab — which week a date range is.
 *
 * The week number has always been arithmetic: seven-day blocks from Monday 16
 * March 2026, the same for every school. That is right until a school's own
 * calendar disagrees with it, and then every figure on the dashboard, every
 * deadline and every printed sheet is confidently wrong in the same direction.
 *
 * So this screen does not offer a calendar to author — the term start already
 * covers the ordinary case, and 38 rows would be a chore nobody completes. It
 * offers the **one week that moved**. Declaring 19–23 Oct to be week 34
 * renumbers the weeks after it automatically, which is what the preview below
 * is for: the administrator sees what the change will do before it does it, and
 * only the first week that needs correcting has to be typed.
 *
 * What is shown is the app's own numbering — the same `weekOptions()` the
 * penyunting's week picker uses — so this table and a teacher's week dropdown
 * can never disagree about what the school calls week 34.
 */

/** A calendar day arithmetic on `yyyy-mm-dd` — no timezone, no Date. */
function plusDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t + days * 86_400_000);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Is this a Monday? `iso_dow === 1` in SQL; the same rule in the browser. */
const isMonday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;

/**
 * The rows as they would be with `next` applied — the cascade, computed from
 * the pure functions rather than guessed.
 */
function withCandidate(
  rows: CalendarRow[],
  next: CalendarAnchor,
  fromWeekNo: number | null,
): CalendarAnchor[] {
  const kept = toAnchors(
    rows
      // The row being edited, and any other claim on this Monday: one date may
      // only ever be one week, exactly as the RPC insists.
      .filter((r) => r.week_no !== fromWeekNo && r.start_date !== next.startDate),
  );
  return [...kept, next].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
}

export function CalendarTab() {
  const { busy, save } = useAdminSave();
  // Subscribed, not read once: the weeks on screen are the app's own numbering,
  // so they have to move the moment a declaration lands anywhere.
  const weekNow = useCurrentWeek();

  const calendar = useQuery({
    queryKey: ["admin-calendar"],
    queryFn: getAdminCalendar,
    retry: false,
  });

  const rows: CalendarRow[] = calendar.data?.anchors ?? [];

  const [startDate, setStartDate] = React.useState("");
  const [weekNo, setWeekNo] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  /**
   * The declaration this form is editing, or null when it is adding one.
   *
   * Captured when a row is picked, not derived from the current date at save
   * time. Deriving it looks cleverer and is wrong: change the Monday of a
   * prefilled edit and the derivation finds nothing at the new date, reports
   * "add", and leaves the old anchor standing — two declarations where the
   * person asked to move one. This is a fact about what the form is *for*,
   * which is exactly the sort of thing that should not be recomputed from the
   * database underneath it.
   */
  const [editingWeek, setEditingWeek] = React.useState<number | null>(null);

  /** Push the store as well as the cache — every screen reads the store. */
  const refresh = React.useCallback(async () => {
    const fresh = await getAdminCalendar();
    setCalendarAnchors(toAnchors(fresh.anchors));
    await calendar.refetch();
  }, [calendar]);

  const proposedWeek = Number(weekNo);
  /**
   * Two different thresholds, on purpose.
   *
   * The button needs a date and a week in range — *not* a Monday. Refusing the
   * button instead would leave a person pressing something dead with no idea
   * why, so `submit` says "Tarikh mula mesti hari Isnin" where they can read it.
   * The preview, though, runs the cascade arithmetic, and a step of seven days
   * is only exact from a Monday — so that one asks for one.
   */
  const formOk =
    ISO_DATE.test(startDate) &&
    Number.isInteger(proposedWeek) &&
    proposedWeek >= 1 &&
    proposedWeek <= 52;
  const previewable = formOk && isMonday(startDate);

  /**
   * What the term-start grid already calls this date — passed an *empty*
   * calendar on purpose, because this is the comparison the declaration is
   * measured against and using the declaration to check itself would let a
   * second anchor contradict the first.
   *
   * A declaration may push numbering forward, never pull it back. The server
   * refuses the same thing for the same reason (and it is the only place that
   * *has* to: `TERM_START` lives in TypeScript, so SQL cannot check it) — but a
   * person should be told why the button is dead rather than press it and read
   * the answer in a toast.
   */
  const gridWeek = previewable ? weekOfIso(startDate, []) : null;
  const belowGrid = gridWeek !== null && proposedWeek < gridWeek;

  /**
   * What the change would do, shown before it happens.
   *
   * Computed from the same two functions the app runs on, with the proposed
   * row swapped in — so the preview is the outcome rather than a description
   * of one.
   */
  const preview = React.useMemo(() => {
    if (!previewable) return null;
    const candidate = withCandidate(
      rows,
      { weekNo: proposedWeek, startDate, label: label.trim() || null },
      editingWeek,
    );
    const downstream: { week: number; monday: string }[] = [];
    for (let w = proposedWeek + 1; w <= proposedWeek + 3; w++) {
      const monday = weekMondayIso(w, candidate);
      if (weekOfIso(monday, candidate) === w) downstream.push({ week: w, monday });
    }
    return { endDate: plusDays(startDate, 4), downstream };
  }, [previewable, rows, proposedWeek, startDate, label, editingWeek]);

  const pick = (row: {
    week: number;
    monday: string;
    label: string | null;
    declared: boolean;
  }) => {
    setStartDate(row.monday);
    setWeekNo(String(row.week));
    setLabel(row.label ?? "");
    setEditingWeek(row.declared ? row.week : null);
    setError(null);
    document.getElementById("tetap-minggu")?.scrollIntoView({ block: "center" });
  };

  const submit = () => {
    if (!ISO_DATE.test(startDate)) {
      setError("Tarikh mula diperlukan.");
      return;
    }
    if (!isMonday(startDate)) {
      setError("Tarikh mula mesti hari Isnin.");
      return;
    }
    if (!Number.isInteger(proposedWeek) || proposedWeek < 1 || proposedWeek > 52) {
      setError("Minggu mesti antara 1 dan 52.");
      return;
    }
    setError(null);

    save(
      () =>
        setCalendarWeek({
          weekNo: proposedWeek,
          startDate,
          endDate: plusDays(startDate, 4),
          label: label.trim() || null,
          fromWeekNo: editingWeek,
        }),
      `Minggu ${proposedWeek} ditetapkan bagi ${startDate}`,
      () => {
        // Whatever this row is called now. A second save replaces what the
        // first one wrote rather than asking the server for a declaration it
        // just moved away from.
        setEditingWeek(proposedWeek);
        void refresh();
      },
    );
  };

  const clear = (week: number) => {
    save(
      () => clearCalendarWeek(week),
      `Minggu ${week} kembali kepada pengiraan automatik`,
      () => {
        // …and if that was the row this form was editing, it is editing
        // nothing now: the next save must add, not ask the server to replace a
        // declaration it has just been told to delete.
        setEditingWeek((current) => (current === week ? null : current));
        void refresh();
      },
    );
  };

  if (calendar.isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-[12.5px] text-ink-4">
          Memuatkan kalendar…
        </CardContent>
      </Card>
    );
  }

  if (calendar.isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-[12.5px] text-ink-4">
          Kalendar minggu tidak dapat dimuatkan.
        </CardContent>
      </Card>
    );
  }

  const declared = new Map(rows.map((r) => [r.week_no, r]));
  const weeks = Array.from({ length: weekNow }, (_, i) => weekNow - i)
    .filter((w) => weekOfIso(weekMondayIso(w)) === w)
    .map((w) => {
      const row = declared.get(w);
      const monday = weekMondayIso(w);
      return {
        week: w,
        monday,
        label: row?.label ?? null,
        declared: Boolean(row),
      };
    });

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CalendarDays className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
          <div>
            <CardTitle>Kalendar minggu</CardTitle>
            <CardDescription>
              Nombor minggu yang digunakan oleh seluruh aplikasi untuk sesi{" "}
              {calendar.data?.session ?? "semasa"}.
            </CardDescription>
          </div>
          <Badge className="ml-auto" variant="neutral">
            {rows.length} ditetapkan
          </Badge>
        </CardHeader>

        <CardContent className="grid gap-4">
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>Minggu</TH>
                  <TH>Tarikh</TH>
                  <TH>Sumber</TH>
                  <TH aria-label="Tindakan" />
                </TR>
              </THead>
              <TBody>
                {weeks.map((w) => (
                  <TR key={w.week}>
                    <TD className="num font-semibold">M{w.week}</TD>
                    <TD>
                      {weekRangeLabel(w.week, w.monday)}
                      {w.label && (
                        <span className="block text-[11.5px] text-ink-4">{w.label}</span>
                      )}
                    </TD>
                    <TD>
                      <Badge variant={w.declared ? "info" : "neutral"}>
                        {w.declared ? "Ditetapkan pentadbir" : "Automatik"}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => pick(w)}
                        >
                          {w.declared ? "Sunting" : "Tetapkan"}
                        </Button>
                        {w.declared && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => clear(w.week)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                            Automatik
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Card id="tetap-minggu">
        <CardHeader>
          <Plus className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
          <div>
            <CardTitle>Tetapkan minggu</CardTitle>
            <CardDescription>
              Nyatakan minggu pertama yang berubah. Minggu selepasnya dikira secara automatik.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="f-isnin" required>
                Tarikh mula
              </Label>
              <Input
                id="f-isnin"
                type="date"
                className="num"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-describedby="isnin-hint"
              />
              <p id="isnin-hint" className="mt-1.5 text-[11.5px] text-ink-4">
                Mesti hari Isnin; berakhir Jumaat.
              </p>
            </div>
            <div>
              <Label htmlFor="f-minggu" required>
                Nombor minggu
              </Label>
              <Input
                id="f-minggu"
                type="number"
                min={1}
                max={52}
                className="num"
                value={weekNo}
                onChange={(e) => setWeekNo(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="f-nama">Nama minggu</Label>
              <Input
                id="f-nama"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Minggu PTS"
                maxLength={80}
              />
            </div>
          </div>

          {preview && (
            <div className="rounded-[10px] border border-border bg-surface-2 p-3 text-[12.5px] leading-[1.6]">
              <p className="font-semibold text-ink-2">Selepas disimpan</p>
              <ul className="mt-1 grid gap-0.5 text-ink-3">
                <li>
                  <span className="num">M{proposedWeek}</span> ·{" "}
                  {weekRangeLabel(proposedWeek, startDate)}
                </li>
                {preview.downstream.map((d) => (
                  <li key={d.week}>
                    <span className="num">M{d.week}</span> · {weekRangeLabel(d.week, d.monday)}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11.5px] text-ink-4">
                Rancangan yang sudah disimpan kekal dengan nombor yang telah digunakan untuknya.
              </p>
            </div>
          )}

          {belowGrid && gridWeek !== null && (
            <p className="text-[12px] text-danger-ink">
              Tarikh itu sudah dikira sebagai Minggu {gridWeek}. Nombor minggu mesti {gridWeek}{" "}
              atau lebih.
            </p>
          )}

          {error && <p className="text-[12px] text-danger-ink">{error}</p>}

          <div>
            <Button disabled={busy || !formOk || belowGrid} onClick={submit}>
              <Plus className="h-4 w-4" strokeWidth={1.9} aria-hidden />
              {editingWeek !== null ? "Simpan perubahan" : "Tetapkan minggu"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
