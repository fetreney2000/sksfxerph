"use client";

import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, LayoutGrid, Pencil, Plus } from "lucide-react";
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
import { FieldError, Input, Label } from "@/components/ui/field";
import { RecordCard } from "@/components/ui/record-card";
import { type ClassRow, createClass, listAdminClasses, setClass } from "@/lib/client/admin";
import { useAdminSave } from "@/lib/hooks/use-admin-save";

/**
 * Tab 2 — classes.
 *
 * This is the list the editor reads. Before it existed the picker served the
 * local demo fixtures in *every* mode, and their ids (`c-5a`) are not UUIDs —
 * `rph_document.class_id` is, and `sync_rph` casts it, so a plan built against
 * a fixture was rejected on every flush with "kelas bukan dalam sekolah/sesi
 * anda". On screen that looked like a sync that never finished. Real class ids
 * are therefore not a convenience here; they are the difference between a plan
 * that saves and one that silently never arrives.
 *
 * Archiving rather than deleting: `rph_document.class_id` has no ON DELETE, so
 * a class with plans behind it cannot be removed — and would not be right to
 * remove, since the plan is a record. `doc_count` is shown for exactly that
 * reason: it turns "archive this class" from a guess into a decision.
 */
export function ClassesTab() {
  const { busy, save } = useAdminSave();

  const classes = useQuery({
    queryKey: ["admin-classes"],
    queryFn: listAdminClasses,
    retry: false,
  });

  const [dialog, setDialog] = React.useState<
    { mode: "add" } | { mode: "edit"; row: ClassRow } | null
  >(null);

  const items = classes.data?.items ?? [];
  const session = classes.data?.session ?? "";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LayoutGrid className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.9} aria-hidden />
        <div className="min-w-0">
          <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Kelas</h2>
          <p className="text-[12.5px] text-ink-3">
            Kelas yang tersedia untuk sesi {session || "semasa"} — inilah yang dipaparkan dalam
            penyunting. Kelas yang diarkibkan tidak lagi ditawarkan, tetapi rancangan sedia ada
            kekal.
          </p>
        </div>
        <Button
          className="ml-auto"
          size="sm"
          disabled={busy || !session}
          onClick={() => setDialog({ mode: "add" })}
        >
          <Plus className="h-4 w-4" strokeWidth={1.9} aria-hidden />
          Tambah kelas
        </Button>
      </div>

      {classes.isLoading ? (
        <p className="py-12 text-center text-[12.5px] text-ink-4">Memuatkan kelas…</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-[12.5px] text-ink-4">
          Tiada kelas untuk sesi ini lagi. Tambah kelas pertama untuk mula menulis RPH.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => (
            <RecordCard
              key={c.id}
              title={c.nama}
              subtitle={
                c.tahun ? `Tahun ${c.tahun}` : c.tingkatan ? `Tingkatan ${c.tingkatan}` : "—"
              }
              badge={
                <Badge variant={c.is_active ? "success" : "neutral"}>
                  {c.is_active ? "Aktif" : "Diarkibkan"}
                </Badge>
              }
              footer={
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setDialog({ mode: "edit", row: c })}
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                    Sunting
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      save(
                        () =>
                          setClass({
                            id: c.id,
                            nama: c.nama,
                            tahun: c.tahun,
                            session,
                            isActive: !c.is_active,
                          }),
                        c.is_active ? `${c.nama} diarkibkan` : `${c.nama} dipulihkan`,
                        () => void classes.refetch(),
                      )
                    }
                  >
                    {c.is_active ? (
                      <Archive className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                    ) : (
                      <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                    )}
                    {c.is_active ? "Arkibkan" : "Pulihkan"}
                  </Button>
                </>
              }
            >
              {/* The count is what turns "archive this class" from a guess into
                  a decision, so it is on the card rather than in a column. */}
              <p className="text-[12.5px] text-ink-3">{c.doc_count} rancangan</p>
            </RecordCard>
          ))}
        </div>
      )}

      <ClassDialog
        state={dialog}
        session={session}
        onOpenChange={(o) => !o && setDialog(null)}
        busy={busy}
        save={(fn, ok) => save(fn, ok, () => void classes.refetch())}
      />
    </>
  );
}

function ClassDialog({
  state,
  session,
  onOpenChange,
  busy,
  save,
}: {
  state: { mode: "add" } | { mode: "edit"; row: ClassRow } | null;
  session: string;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  save: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const editing = state?.mode === "edit" ? state.row : null;
  const [nama, setNama] = React.useState("");
  const [tahun, setTahun] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Adopt the row's values only when the dialog changes identity — reading them
  // on every render would fight the person typing into the field.
  React.useEffect(() => {
    if (!state) return;
    setNama(editing?.nama ?? "");
    setTahun(editing?.tahun ? String(editing.tahun) : "");
    setError(null);
  }, [state, editing]);

  const submit = () => {
    if (!nama.trim()) {
      setError("Nama kelas diperlukan.");
      return;
    }
    const tahunNum = tahun.trim() === "" ? null : Number(tahun);
    if (tahunNum !== null && (!Number.isInteger(tahunNum) || tahunNum < 1 || tahunNum > 6)) {
      setError("Tahun mesti antara 1 dan 6.");
      return;
    }
    setError(null);

    if (editing) {
      save(
        () =>
          setClass({
            id: editing.id,
            nama: nama.trim(),
            tahun: tahunNum,
            session,
            isActive: editing.is_active,
          }),
        "Kelas dikemas kini",
      );
    } else {
      save(
        () => createClass({ nama: nama.trim(), tahun: tahunNum, session }),
        "Kelas ditambah",
      );
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Sunting kelas" : "Tambah kelas"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Nama dan tahun kelas dalam sesi ini."
              : `Kelas baharu untuk sesi ${session}. Ia akan muncul dalam penyunting serta-merta.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <div>
            <Label htmlFor="class-nama" required>
              Nama kelas
            </Label>
            <Input
              id="class-nama"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="5 Amanah"
            />
          </div>
          <div>
            <Label htmlFor="class-tahun">Tahun</Label>
            <Input
              id="class-tahun"
              type="number"
              min={1}
              max={6}
              className="num"
              value={tahun}
              onChange={(e) => setTahun(e.target.value)}
              placeholder="5"
            />
            <p className="mt-1.5 text-[11.5px] text-ink-4">
              Kosongkan untuk sekolah menengah (gunakan tingkatan).
            </p>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button disabled={busy} onClick={submit}>
            {editing ? "Simpan" : "Tambah kelas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
