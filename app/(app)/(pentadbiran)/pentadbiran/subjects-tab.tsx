"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
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
import { FieldError, Input, Label, Select } from "@/components/ui/field";
import { RecordCard } from "@/components/ui/record-card";
import { createSubject, listAdminSubjects, setSubject } from "@/lib/client/admin";
import { useAdminSave } from "@/lib/hooks/use-admin-save";
import type { Curriculum } from "@/lib/types";

/**
 * Tab 3 — subjects.
 *
 * The switch is `is_active`, never a delete: `rph_document.subject_code` and
 * `dskp_standard.subject_code` both reference `erph.subject`, so removing a row
 * would take every plan already written against it — and with it a statutory
 * record of teaching. Turning a subject off instead stops the editor offering
 * it to teachers from that moment on, which is the actual need ("this school
 * does not teach Bahasa Inggeris this year") without destroying anything.
 *
 * `doc_count` is why the toggle sits next to a number rather than being a bare
 * switch: seeing "37 rancangan" is what makes it clear this is a *stop offering*
 * action and not a removal.
 */
const CURRICULUMS: { value: Curriculum; label: string }[] = [
  { value: "KSSR", label: "KSSR (Sekolah Rendah)" },
  { value: "KSSM", label: "KSSM (Sekolah Menengah)" },
  { value: "PRASEKOLAH", label: "Prasekolah" },
];

export function SubjectsTab() {
  const { busy, save } = useAdminSave();

  const subjects = useQuery({
    queryKey: ["admin-subjects"],
    queryFn: listAdminSubjects,
    retry: false,
  });

  const [creating, setCreating] = React.useState(false);
  const items = subjects.data?.items ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <BookOpen className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.9} aria-hidden />
        <div className="min-w-0">
          <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Mata pelajaran</h2>
          <p className="text-[12.5px] text-ink-3">
            Mata pelajaran yang ditawarkan kepada guru. Mematikan satu item menyembunyikannya
            daripada penyunting — rancangan sedia ada tidak terjejas.
          </p>
        </div>
        <Button className="ml-auto" size="sm" disabled={busy} onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" strokeWidth={1.9} aria-hidden />
          Tambah mata pelajaran
        </Button>
      </div>

      {subjects.isLoading ? (
        <p className="py-12 text-center text-[12.5px] text-ink-4">Memuatkan mata pelajaran…</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-[12.5px] text-ink-4">Tiada mata pelajaran.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <RecordCard
              key={s.code}
              title={s.nama}
              subtitle={
                <>
                  <span className="font-mono font-semibold text-ink-2">{s.code}</span>
                  <span className="text-ink-4"> · {s.curriculum}</span>
                </>
              }
              badge={
                <Badge variant={s.is_active ? "success" : "neutral"}>
                  {s.is_active ? "Ditawarkan" : "Tidak ditawarkan"}
                </Badge>
              }
              footer={
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    save(
                      () => setSubject(s.code, !s.is_active),
                      s.is_active
                        ? `${s.nama} disembunyikan daripada penyunting`
                        : `${s.nama} ditawarkan semula`,
                      () => void subjects.refetch(),
                    )
                  }
                >
                  {s.is_active ? "Matikan" : "Hidupkan"}
                </Button>
              }
            >
              <p className="text-[12.5px] text-ink-3">{s.doc_count} rancangan</p>
            </RecordCard>
          ))}
        </div>
      )}

      <SubjectDialog
        open={creating}
        onOpenChange={setCreating}
        busy={busy}
        save={(fn, ok) => save(fn, ok, () => void subjects.refetch())}
      />
    </>
  );
}

function SubjectDialog({
  open,
  onOpenChange,
  busy,
  save,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  save: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const [code, setCode] = React.useState("");
  const [nama, setNama] = React.useState("");
  const [curriculum, setCurriculum] = React.useState<Curriculum>("KSSR");
  const [error, setError] = React.useState<string | null>(null);

  const submit = () => {
    const trimmed = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(trimmed)) {
      setError("Kod subjek: 2-12 aksara huruf besar atau nombor.");
      return;
    }
    if (!nama.trim()) {
      setError("Nama mata pelajaran diperlukan.");
      return;
    }
    setError(null);
    save(
      () => createSubject({ code: trimmed, nama: nama.trim(), curriculum }),
      "Mata pelajaran ditambah",
    );
    onOpenChange(false);
    setCode("");
    setNama("");
    setCurriculum("KSSR");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah mata pelajaran</DialogTitle>
          <DialogDescription>
            Kod mesti unik. Mata pelajaran baharu muncul dalam penyunting serta-merta.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="subj-code" required>
                Kod
              </Label>
              <Input
                id="subj-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="BI"
                className="num"
              />
            </div>
            <div>
              <Label htmlFor="subj-curriculum">Kurikulum</Label>
              <Select
                id="subj-curriculum"
                value={curriculum}
                onChange={(e) => setCurriculum(e.target.value as Curriculum)}
              >
                {CURRICULUMS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="subj-nama" required>
              Nama mata pelajaran
            </Label>
            <Input
              id="subj-nama"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="Bahasa Inggeris"
            />
          </div>
          {error && <FieldError>{error}</FieldError>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button disabled={busy} onClick={submit}>
            Tambah
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
