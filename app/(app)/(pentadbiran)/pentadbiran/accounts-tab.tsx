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
import { TableContainer } from "@/components/ui/table";
import {
  createAccount,
  listMembers,
  type Member,
  resetPassword,
  setJawatan,
  setMember,
  setSupervisor,
  unlockMember,
} from "@/lib/client/admin";
import { formatMyt } from "@/lib/date";
import { useAdminSave } from "@/lib/hooks/use-admin-save";
import { ms } from "@/lib/i18n/ms";
import { JAWATAN_BY_ROLE, type Jawatan, MEMBER_ROLES, type MemberRole } from "@/lib/types";

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

/**
 * What the jawatan should be when a role is chosen or changed.
 *
 * Kept if the new role can still hold it, otherwise the single office that
 * role implies, otherwise unset. `gpk` deliberately lands on unset: its three
 * Penolong Kanan offices are a choice only the school can make, and picking one
 * here would put a name on paper nobody confirmed.
 */
function jawatanFor(role: MemberRole, current: Jawatan | null): Jawatan | null {
  const offices = JAWATAN_BY_ROLE[role] ?? [];
  if (current !== null && offices.includes(current)) return current;
  if (offices.length !== 1) return null;
  return offices[0] ?? null;
}

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
  return formatMyt({
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/**
 * Who may be this member's penyelia — the level above, and only the level
 * above.
 *
 * A Guru Biasa's work is overseen by a GPK or the Guru Besar. A GPK's own RPH
 * is reviewed by a Guru Besar, so that is the whole list for a GPK: a peer GPK
 * cannot review it. A Guru Besar answers to another Guru Besar, and if the
 * school has one, only. The pentadbir holds no office and writes no RPH, so
 * theirs has nobody and says so.
 *
 * That the Guru Besar already reaches every plan in the school is the reason
 * assigning one to a GPK changes no access — it records who reviews that
 * person's work, which is what the column is for, rather than granting it.
 */
function supervisorsFor(m: Member, items: Member[]): Member[] {
  const above: readonly MemberRole[] =
    m.role === "guru_biasa"
      ? (["gpk", "guru_besar"] as const)
      : m.role === "gpk" || m.role === "guru_besar"
        ? (["guru_besar"] as const)
        : [];
  if (above.length === 0) return [];
  // `is_active`, because SQL refuses an inactive supervisor and a picker that
  // offers one would only produce an error the administrator cannot act on.
  return items.filter((s) => s.user_id !== m.user_id && s.is_active && above.includes(s.role));
}

/** What the row says when there is nobody above this one to choose. */
function noSupervisorText(role: MemberRole): string {
  if (role === "guru_biasa") return "Tiada GPK — hanya Guru Besar";
  if (role === "gpk") return "Tiada Guru Besar";
  if (role === "guru_besar") return "Tiada Guru Besar lain";
  return "—";
}

/** The unassigned option. For a teacher it means the Guru Besar alone. */
const UNASSIGNED: Record<MemberRole, string> = {
  guru_biasa: "— Guru Besar sahaja —",
  gpk: "— belum ditetapkan —",
  guru_besar: "— belum ditetapkan —",
  pentadbir: "—",
  system: "—",
};

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
              Peranan menentukan apa yang boleh dilihat dan dilakukan; jawatan ialah gelaran
              yang tertera pada baris JAWATAN dalam cetakan mingguan. Kesemua lima peranan
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
            <TableContainer>
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-surface-2">
                    {[
                      "Nama",
                      "Peranan",
                      "Jawatan",
                      "Penyelia",
                      "Status",
                      "Log masuk terakhir",
                      "",
                    ].map((h) => (
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
                        // A role change can take an office away with it — SQL
                        // clears a jawatan the new role cannot hold, so say so
                        // rather than let the row quietly empty itself.
                        m.jawatan !== null && !(JAWATAN_BY_ROLE[role] ?? []).includes(m.jawatan)
                          ? `Peranan ${m.full_name} dikemas kini — jawatan lama ditanggalkan`
                          : `Peranan ${m.full_name} dikemas kini`,
                        () => void accounts.refetch(),
                      );

                    // The offices this role may hold; empty for the pentadbir
                    // and the service account, which hold none at all.
                    const offices = JAWATAN_BY_ROLE[m.role] ?? [];

                    const changeJawatan = (jawatan: Jawatan | null) =>
                      save(
                        () => setJawatan(m.user_id, jawatan),
                        jawatan
                          ? `Jawatan ${m.full_name} dikemas kini`
                          : `Jawatan ${m.full_name} dikosongkan`,
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

                    // The level above this member, so a GPK's own RPH is not
                    // left reviewable by a peer. See `supervisorsFor`.
                    const supervisors = supervisorsFor(m, items);

                    const changeSupervisor = (supervisorId: string | null) =>
                      save(
                        () => setSupervisor(m.user_id, supervisorId),
                        supervisorId
                          ? `Penyelia ${m.full_name} dikemas kini`
                          : m.role === "guru_biasa"
                            ? `${m.full_name} kini hanya kelihatan kepada Guru Besar`
                            : `Penyelia ${m.full_name} dikosongkan`,
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
                            title={
                              own ? "Anda tidak boleh mengubah peranan sendiri" : undefined
                            }
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
                          {/* The office, not the permission — it is what the
                              cover sheet prints under the signer's name, which
                              is why it is chosen per person instead of being
                              derived from the role beside it: one GPK role
                              covers three different Penolong Kanan offices. */}
                          {offices.length === 0 ? (
                            <span className="text-[12.5px] text-ink-4">—</span>
                          ) : (
                            <Select
                              aria-label={`Jawatan ${m.full_name}`}
                              value={m.jawatan ?? ""}
                              className="w-[190px] py-1.5 text-[12.5px]"
                              disabled={busy}
                              onChange={(e) =>
                                changeJawatan((e.target.value || null) as Jawatan | null)
                              }
                            >
                              <option value="">— belum ditetapkan —</option>
                              {offices.map((j) => (
                                <option key={j} value={j}>
                                  {ms.jawatan[j]}
                                </option>
                              ))}
                            </Select>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {/* Scope, not decoration: this decides who may open
                            and review this person's RPH. The list is the level
                            above — a GPK's own work is reviewed by the Guru
                            Besar, and a Guru Besar by another Guru Besar if
                            the school has one. */}
                          {supervisors.length === 0 ? (
                            <span className="text-[12px] text-ink-4">
                              {noSupervisorText(m.role)}
                            </span>
                          ) : (
                            <Select
                              aria-label={`Penyelia ${m.full_name}`}
                              value={m.supervisor_id ?? ""}
                              className="w-[190px] py-1.5 text-[12.5px]"
                              disabled={busy}
                              onChange={(e) => changeSupervisor(e.target.value || null)}
                            >
                              <option value="">{UNASSIGNED[m.role]}</option>
                              {supervisors.map((s) => (
                                <option key={s.user_id} value={s.user_id}>
                                  {s.full_name} · {ms.roles[s.role]}
                                </option>
                              ))}
                            </Select>
                          )}
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
                                own
                                  ? "Anda tidak boleh menyahaktifkan akaun sendiri"
                                  : undefined
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
            </TableContainer>
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
  const [jawatan, setJawatan] = React.useState<Jawatan | null>(() =>
    jawatanFor("guru_biasa", null),
  );
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const offices = JAWATAN_BY_ROLE[role] ?? [];

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
          jawatan,
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
    setJawatan(jawatanFor("guru_biasa", null));
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
                onChange={(e) => {
                  const next = e.target.value as MemberRole;
                  setRole(next);
                  setJawatan(jawatanFor(next, jawatan));
                }}
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
          {/* Only where a role has an office to hold: the pentadbir's account
              exists to set the app up, and printing a JAWATAN for it would be
              inventing one. */}
          {offices.length > 0 && (
            <div>
              <Label htmlFor="acc-jawatan">Jawatan</Label>
              <Select
                id="acc-jawatan"
                value={jawatan ?? ""}
                onChange={(e) => setJawatan((e.target.value || null) as Jawatan | null)}
              >
                <option value="">— belum ditetapkan —</option>
                {offices.map((j) => (
                  <option key={j} value={j}>
                    {ms.jawatan[j]}
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-[11.5px] text-ink-4">
                Gelaran ini yang tertera pada baris JAWATAN ketika cetakan mingguan
                ditandatangani.
              </p>
            </div>
          )}
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
