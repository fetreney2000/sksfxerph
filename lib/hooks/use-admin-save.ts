"use client";

import * as React from "react";
import { toast } from "sonner";

/**
 * Run an admin write, toast the outcome, then refresh the list behind it.
 *
 * Every tab on `/pentadbiran` does exactly this, and the interesting part is
 * the *error* path: the server returns a Malay sentence ("Nama pengguna ini
 * telah digunakan", "Kelas ini sudah wujud dalam sesi ini") precisely so it can
 * be shown to the person who caused it. A helper that swallowed the message in
 * favour of a generic "Gagal menyimpan" would undo that work, so the message is
 * carried through verbatim and only falls back when there is none.
 *
 * `busy` disables the whole form rather than the one button: these writes are
 * not idempotent (double-submitting "Tambah akaun" would try to create two),
 * and one flag is easier to reason about than one per control.
 */
export interface AdminSave {
  busy: boolean;
  save: (fn: () => Promise<unknown>, okMessage: string, onDone?: () => void) => Promise<void>;
}

export function useAdminSave(): AdminSave {
  const [busy, setBusy] = React.useState(false);

  const save = React.useCallback(
    async (fn: () => Promise<unknown>, okMessage: string, onDone?: () => void) => {
      setBusy(true);
      try {
        await fn();
        toast.success(okMessage);
        onDone?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { busy, save };
}
