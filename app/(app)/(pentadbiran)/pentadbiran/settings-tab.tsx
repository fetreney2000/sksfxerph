"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, KeyRound, School } from "lucide-react";
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
import { Input, Label, Select } from "@/components/ui/field";
import { getSettings, type SchoolSetting, setSettings } from "@/lib/client/admin";
import { useAdminSave } from "@/lib/hooks/use-admin-save";
import { setSession } from "@/lib/session";

/**
 * Tab 4 — session and the weekly deadline.
 *
 * The session field was read-only for as long as `SESSION` was a build-time
 * constant, which meant the school year could only be rolled over by editing
 * source and redeploying — the one thing an administrator cannot do. It is
 * editable now, and the write goes three ways at once: the database row, the
 * server-side queries that filter on it, and `setSession()` here, which pushes
 * the new value into the client store so the very next plan is stamped with it.
 *
 * That last hop is the one that matters. If only the server changed, a teacher's
 * next plan would carry the old year, `sync_rph` would reject it for belonging
 * to the wrong session, and the symptom would be a sync that never finishes.
 *
 * The consequence is stated in the UI rather than discovered: rolling the year
 * over moves every existing plan out of the dashboard and archive, because both
 * filter on the current session. Those rows are not deleted — they are in the
 * database, and switching back shows them again.
 */

const WEEKDAYS: [number, string][] = [
  [1, "Isnin"],
  [2, "Selasa"],
  [3, "Rabu"],
  [4, "Khamis"],
  [5, "Jumaat"],
  [6, "Sabtu"],
  [7, "Ahad"],
];

export function SettingsTab() {
  const { busy, save } = useAdminSave();

  const settings = useQuery({
    queryKey: ["admin-settings"],
    queryFn: getSettings,
    retry: false,
  });

  const [weekday, setWeekday] = React.useState(5);
  const [time, setTime] = React.useState("16:00");
  const [requireComplete, setRequireComplete] = React.useState(true);
  const [sessionInput, setSessionInput] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [adopted, setAdopted] = React.useState(false);

  const stored: SchoolSetting | null = settings.data?.setting ?? null;
  const school = settings.data?.school ?? null;

  // The form is an editor, not a mirror: adopt the stored values once, then let
  // the administrator change them without a response refetch overwriting what
  // they are in the middle of typing.
  React.useEffect(() => {
    if (!stored || adopted) return;
    setWeekday(stored.submit_weekday);
    setTime(stored.submit_time.slice(0, 5));
    setRequireComplete(stored.require_complete);
    setSessionInput(stored.current_session);
    setAdopted(true);
  }, [stored, adopted]);

  const sessionChanged = Boolean(stored && sessionInput !== stored.current_session);

  const submit = () => {
    if (!/^\d{4}\/\d{4}$/.test(sessionInput)) {
      setError("Sesi mesti dalam bentuk TTTT/TTTT, contohnya 2026/2027.");
      return;
    }
    setError(null);

    save(
      () =>
        setSettings({
          submitWeekday: weekday,
          submitTime: time,
          requireComplete,
          currentSession: sessionInput,
        }),
      sessionChanged ? `Sesi ditukar kepada ${sessionInput}` : "Tetapan sekolah dikemas kini",
      () => {
        // Adopt the new year client-side straight away: the dashboard, the
        // archive and the plan stamps all read this store, so waiting for a
        // refetch would leave them on the old value until the next navigation.
        setSession(sessionInput);
        void settings.refetch();
      },
    );
  };

  if (settings.isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-[12.5px] text-ink-4">
          Memuatkan tetapan…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <School className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
          <div>
            <CardTitle>Sesi &amp; tarikh akhir</CardTitle>
            <CardDescription>Peraturan penghantaran untuk keseluruhan sekolah.</CardDescription>
          </div>
          {school && (
            <Badge className="ml-auto" variant="neutral">
              {school.kod_sekolah}
            </Badge>
          )}
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="f-sesi" required>
                Sesi semasa
              </Label>
              <Input
                id="f-sesi"
                className="num"
                value={sessionInput}
                onChange={(e) => setSessionInput(e.target.value)}
                placeholder="2026/2027"
                aria-describedby="sesi-hint"
              />
              <p id="sesi-hint" className="mt-1.5 text-[11.5px] text-ink-4">
                Format TTTT/TTTT.
              </p>
            </div>
            <div>
              <Label htmlFor="f-hari">Hari akhir mingguan</Label>
              <Select
                id="f-hari"
                value={String(weekday)}
                onChange={(e) => setWeekday(Number(e.target.value))}
              >
                {WEEKDAYS.map(([n, name]) => (
                  <option key={n} value={n}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="f-masa">Waktu akhir</Label>
              <Input
                id="f-masa"
                type="time"
                className="num"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={requireComplete}
              onChange={(e) => setRequireComplete(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
            />
            <span>
              Halang penghantaran sehingga keluargaan 100%
              <span className="mt-0.5 block text-[11.5px] text-ink-4">
                Guru hanya boleh menghantar apabila semua seksyen wajib telah diisi.
              </span>
            </span>
          </label>

          {/* Stated before the write, not after: this moves every existing plan
              out of the dashboard and archive, and an administrator should be
              able to weigh that rather than discover it. */}
          {sessionChanged && (
            <div className="flex gap-2.5 rounded-[10px] border border-warning-line bg-warning-soft p-3">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink"
                strokeWidth={1.9}
                aria-hidden
              />
              <div className="text-[12.5px] leading-[1.55] text-warning-ink">
                <p className="font-semibold">
                  Menukar sesi kepada {sessionInput || "sesi baharu"} menjejaskan semua guru.
                </p>
                <p className="mt-1">
                  Rancangan sesi {stored?.current_session} tidak akan dipaparkan dalam papan
                  pemuka mahupun arkib sehingga sesi ditukar semula. Tiada data dipadam — ia
                  kekal dalam pangkalan data.
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-[12px] text-danger-ink">{error}</p>}

          <div>
            <Button disabled={busy || !adopted} onClick={submit}>
              <KeyRound className="h-4 w-4" strokeWidth={1.9} aria-hidden />
              Simpan tetapan
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Info className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
          <div>
            <CardTitle>Tentang tetapan ini</CardTitle>
            <CardDescription>
              Perubahan berkuat kuasa serta-merta untuk semua guru, tanpa perlu log masuk
              semula.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 text-[12.5px] leading-[1.6] text-ink-3">
          <p>
            <span className="font-semibold text-ink-2">Tarikh akhir</span> menentukan bila
            "ketepatan masa" diukur — rancangan yang tiba selepas waktu ini dikira lewat.
          </p>
          <p>
            <span className="font-semibold text-ink-2">Keluargaan 100%</span> menghalang
            penghantaran yang belum lengkap, supaya penyemak tidak menerima draf separuh siap.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
