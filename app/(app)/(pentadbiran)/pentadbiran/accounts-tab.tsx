"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound, Unlock, UserPlus, Users } from "lucide-react";
import * as React from "react";
import { useUser } from "@/components/shell/user-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  createAccount,
  listMembers,
  type Member,
  resetPassword,
  setMember,
  unlockMember,
} from "@/lib/client/admin";
import { useAdminSave } from "@/lib/hooks/use-admin-save";
import { ms } from "@/lib/i18n/ms";
import { MEMBER_ROLES, type MemberRole } from "@/lib/types";

/**
 * Tab 1 — accounts and roles.
 *
 * Three writes the administrator could not do before: create an account, reset a
 * forgotten password, and lift a brute-force lock. Each exists because the
 * alternative was worse — a locked-out teacher had to wait fifteen minutes or
 * someone with database access had to run SQL.
 *
 * The lockout state is derived, not a stored flag: `locked_until` in the future
 * is a locked account. That distinction matters in the UI because the two have
 * different remedies (reset the password versus unlock it), and collapsing them
 * into one "inactive" badge would hide which one applies.
 */

/** Roles an administrator may hand out — `system` is a service account. */
const ASSIGNABLE = MEMBER_ROLES.filter((r) => r !== "system");

type LockState = "active" | "locked" | "inactive";

function lockState(m: Member): LockState {
  if (!m.is_active) return "inactive";
  if (m.locked_until && new Date(m.locked_until) > new Date()) return "locked";
  return "active";
}

const STATUS: Record<LockState, { label: string; variant: "success" | "warning" | "neutral" }> =
  {
    active: { label: "Aktif", variant: "success" },
    locked: { label: "Dikunci", variant: "warning" },
    inactive: { label: "Dinyahaktif", variant: "neutral" },
  };

/** `2026-10-05T08:12:00+00:00` → `5 Okt 2026, 4:12 ptg` — never a raw ISO string. */
function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ms-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function AccountsTab() {
  const { id: myId } = useUser();
  const { busy, save } = useAdminSave();

  const accounts = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: listMembers,
    retry: false,
  });

  const [creating, setCreating] = React.useState(false);
  const [resetting, setResetting] = React.useState<Member | null>(null);

  const items = accounts.data?.items ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <Users className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
          <div>
            <CardTitle>Akaun &amp; peranan</CardTitle>
            <CardDescription>
              Peranan menentukan apa yang boleh dilihat dan dilakukan. Kesemua lima peranan
              mempunyai akses kepada RPH sendiri.
            </CardDescription>
          </div>
          <Button
            className="ml-auto"
            size="sm"
            disabled={busy}
            onClick={() => setCreating(true)}
          >
            <UserPlus className="h-4 w-4" strokeWidth={1.9} aria-hidden />
            Tambah akaun
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {accounts.isLoading ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-ink-4">Memuatkan akaun…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-ink-4">
              Tiada akaun ditemui.
            </p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-surface-2">
                  {["Nama", "Peranan", "Status", "Log masuk terakhir", ""].map((h) => (
                    <th
                      key={h}
                      className="border-b border-border px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.7px] text-ink-4 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((m) => {
                  const own = m.user_id === myId;
                  const state = lockState(m);
                  const status = STATUS[state];

                  const changeRole = (role: MemberRole) =>
                    save(
                      () => setMember(m.user_id, role, m.is_active),
                      `Peranan ${m.full_name} dikemas kini`,
                      () => void accounts.refetch(),
                    );

                  const toggleActive = () =>
                    save(
                      () => setMember(m.user_id, m.role, !m.is_active),
                      m.is_active
                        ? `${m.full_name} dinyahaktifkan`
                        : `${m.full_name} diaktifkan`,
                      () => void accounts.refetch(),
                    );

                  return (
                    <tr key={m.user_id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="block font-semibold text-ink">{m.full_name}</span>
                        <span className="block text-[11.5px] text-ink-4">
                          {m.username}
                          {m.email ? ` · ${m.email}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Select
                          aria-label={`Peranan ${m.full_name}`}
                          value={m.role}
                          className="w-[190px] py-1.5 text-[12.5px]"
                          disabled={busy || own}
                          title={own ? "Anda tidak boleh mengubah peranan sendiri" : undefined}
                          onChange={(e) => changeRole(e.target.value as MemberRole)}
                        >
                          {ASSIGNABLE.map((r) => (
                            <option key={r} value={r}>
                              {ms.roles[r]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {state === "locked" && (
                          <span className="mt-1 block text-[11.5px] text-ink-4">
                            {m.failed_logins} percubaan gagal
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-ink-3">
                        {when(m.last_login_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {state === "locked" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                save(
                                  () => unlockMember(m.user_id),
                                  `Kunci ${m.full_name} dibuka`,
                                  () => void accounts.refetch(),
                                )
                              }
                            >
                              <Unlock className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                              Buka kunci
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setResetting(m)}
                          >
                            <KeyRound className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                            Tetap semula kata laluan
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || own}
                            title={
                              own ? "Anda tidak boleh menyahaktifkan akaun sendiri" : undefined
                            }
                            onClick={toggleActive}
                          >
                            {m.is_active ? "Nyahaktif" : "Aktifkan"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <CreateAccountDialog
        open={creating}
        onOpenChange={setCreating}
        busy={busy}
        save={(fn, ok) => save(fn, ok, () => void accounts.refetch())}
      />

      <ResetPasswordDialog
        member={resetting}
        onOpenChange={(o) => !o && setResetting(null)}
        busy={busy}
        save={(fn, ok) =>
          save(fn, ok, () => {
            setResetting(null);
            void accounts.refetch();
          })
        }
      />
    </>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  save: (fn: () => Promise<unknown>, ok: string) => void;
}

function CreateAccountDialog({ open, onOpenChange, busy, save }: DialogProps) {
  const [username, setUsername] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [role, setRole] = React.useState<MemberRole>("guru_biasa");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = () => {
    if (!username.trim() || !fullName.trim() || password.length < 8) {
      setError("Isi nama pengguna, nama penuh, dan kata laluan sekurang-kurangnya 8 aksara.");
      return;
    }
    setError(null);
    save(
      () =>
        createAccount({
          username: username.trim(),
          fullName: fullName.trim(),
          role,
          email: email.trim() || null,
          password,
        }),
      "Akaun dicipta",
    );
    onOpenChange(false);
    setUsername("");
    setFullName("");
    setEmail("");
    setPassword("");
    setRole("guru_biasa");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah akaun</DialogTitle>
          <DialogDescription>
            Akaun baharu terus disenaraikan dalam sekolah ini dan boleh log masuk dengan kata
            laluan yang anda tetapkan.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <div>
            <Label htmlFor="acc-username" required>
              Nama pengguna
            </Label>
            <Input
              id="acc-username"
              value={username}
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value)}
              placeholder="nurul.aisyah"
            />
          </div>
          <div>
            <Label htmlFor="acc-name" required>
              Nama penuh
            </Label>
            <Input
              id="acc-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nurul Aisyah binti Rahim"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="acc-role">Peranan</Label>
              <Select
                id="acc-role"
                value={role}
                onChange={(e) => setRole(e.target.value as MemberRole)}
              >
                {ASSIGNABLE.map((r) => (
                  <option key={r} value={r}>
                    {ms.roles[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="acc-email">Emel</Label>
              <Input
                id="acc-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pilihan"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="acc-password" required>
              Kata laluan sementara
            </Label>
            <Input
              id="acc-password"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1.5 text-[11.5px] text-ink-4">
              Sekurang-kurangnya 8 aksara. Beritahu guru ini untuk menukarnya selepas log masuk
              pertama.
            </p>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button disabled={busy} onClick={submit}>
            Cipta akaun
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  member,
  onOpenChange,
  busy,
  save,
}: {
  member: Member | null;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  save: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!member) {
      setPassword("");
      setError(null);
    }
  }, [member]);

  const submit = () => {
    if (!member) return;
    if (password.length < 8) {
      setError("Kata laluan: sekurang-kurangnya 8 aksara.");
      return;
    }
    setError(null);
    save(() => resetPassword(member.user_id, password), "Kata laluan ditetapkan semula");
    setPassword("");
  };

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tetapkan semula kata laluan</DialogTitle>
          <DialogDescription>
            {member ? `${member.full_name} akan log masuk dengan kata laluan baharu.` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Label htmlFor="reset-password" required>
            Kata laluan baharu
          </Label>
          <Input
            id="reset-password"
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          {/* The honest consequence: this is a "log out all devices" operation,
              and the administrator needs to be able to warn the teacher rather
              than have them discover it mid-lesson. */}
          <p className="mt-2 text-[11.5px] text-ink-4">
            Semua sesi sedia ada akan ditamatkan, dan kunci percubaan gagal akan dibuka.
          </p>
          {error && <FieldError>{error}</FieldError>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button disabled={busy} onClick={submit}>
            Tetapkan semula
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
