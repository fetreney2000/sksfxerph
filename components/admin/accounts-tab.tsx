"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound, Pencil, Search, Unlock, UserPlus, Users } from "lucide-react";
import * as React from "react";
import { useUser } from "@/components/shell/user-context";
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
import { byName, CardField, RecordCard } from "@/components/ui/record-card";
import {
  createAccount,
  listMembers,
  type Member,
  resetPassword,
  setJawatan,
  setMember,
  setProfile,
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
  const [editing, setEditing] = React.useState<Member | null>(null);

  const items = accounts.data?.items ?? [];

  // Seventy-odd cards is a list to search rather than to scroll. Matches the
  // name, the username or the email — the three things someone is holding when
  // they come here looking for one person.
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? items.filter((m) =>
        [m.full_name, m.username, m.email ?? ""].some((f) => f.toLowerCase().includes(needle)),
      )
    : items;
  // A→Z by the name on the card: the endpoint orders by role, which grouped the
  // roster sensibly under headers and shuffles it into a grid.
  const ordered = [...shown].sort(byName((m) => m.full_name));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Users className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.9} aria-hidden />
        <div className="min-w-0">
          <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Akaun dan peranan</h2>
          <p className="text-[12.5px] text-ink-3">
            Peranan menentukan apa yang boleh dilihat dan dilakukan; jawatan ialah gelaran yang
            tertera pada baris JAWATAN dalam cetakan mingguan. Kesemua lima peranan mempunyai
            akses kepada RPH sendiri.
          </p>
        </div>
        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4"
              strokeWidth={1.9}
              aria-hidden
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama, nama pengguna atau emel…"
              aria-label="Cari akaun"
              className="pl-9"
            />
          </div>
          <Button size="sm" disabled={busy} onClick={() => setCreating(true)}>
            <UserPlus className="h-4 w-4" strokeWidth={1.9} aria-hidden />
            Tambah akaun
          </Button>
        </div>
      </div>

      {accounts.isLoading ? (
        <p className="py-12 text-center text-[12.5px] text-ink-4">Memuatkan akaun…</p>
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-[12.5px] text-ink-4">
          {needle ? `Tiada akaun sepadan dengan “${q.trim()}”.` : "Tiada akaun ditemui."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map((m) => {
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
                m.is_active ? `${m.full_name} dinyahaktifkan` : `${m.full_name} diaktifkan`,
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
              <RecordCard
                key={m.user_id}
                title={m.full_name}
                subtitle={
                  <>
                    {m.username}
                    {m.email ? ` · ${m.email}` : ""}
                  </>
                }
                badge={<Badge variant={status.variant}>{status.label}</Badge>}
                footer={
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setEditing(m)}
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                      Sunting
                    </Button>
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
                      title={own ? "Anda tidak boleh menyahaktifkan akaun sendiri" : undefined}
                      onClick={toggleActive}
                    >
                      {m.is_active ? "Nyahaktif" : "Aktifkan"}
                    </Button>
                  </>
                }
              >
                <CardField label="Peranan">
                  <Select
                    aria-label={`Peranan ${m.full_name}`}
                    value={m.role}
                    className="w-full py-1.5 text-[12.5px]"
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
                </CardField>
                {/* The office, not the permission — it is what the cover
                            sheet prints under the signer's name, which is why it
                            is chosen per person instead of being derived from the
                            role beside it: one GPK role covers three different
                            Penolong Kanan offices. */}
                <CardField label="Jawatan">
                  {offices.length === 0 ? (
                    <p className="py-1.5 text-[12.5px] text-ink-4">—</p>
                  ) : (
                    <Select
                      aria-label={`Jawatan ${m.full_name}`}
                      value={m.jawatan ?? ""}
                      className="w-full py-1.5 text-[12.5px]"
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
                </CardField>
                {/* Scope, not decoration: this decides who may open and
                            review this person's RPH. The list is the level
                            above — a GPK's own work is reviewed by the Guru
                            Besar, and a Guru Besar by another Guru Besar if the
                            school has one. */}
                <CardField label="Penyelia">
                  {supervisors.length === 0 ? (
                    <p className="py-1.5 text-[12px] text-ink-4">{noSupervisorText(m.role)}</p>
                  ) : (
                    <Select
                      aria-label={`Penyelia ${m.full_name}`}
                      value={m.supervisor_id ?? ""}
                      className="w-full py-1.5 text-[12.5px]"
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
                </CardField>
                <p className="flex flex-wrap items-baseline gap-x-3 text-[11.5px] text-ink-4">
                  {state === "locked" && <span>{m.failed_logins} percubaan gagal</span>}
                  <span>Log masuk terakhir {when(m.last_login_at)}</span>
                </p>
              </RecordCard>
            );
          })}
        </div>
      )}

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

      <EditAccountDialog
        member={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        busy={busy}
        save={(fn, ok) =>
          save(fn, ok, () => {
            setEditing(null);
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
                Gelaran ini akan tertera pada baris JAWATAN ketika cetakan mingguan
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

/**
 * Correct what an account was created with.
 *
 * The name and the address were both frozen at creation — the name printed on
 * every RPH this person writes, and the one Google sign-in matches on a first
 * visit — so a typo used to mean deleting the account and importing it again,
 * taking that teacher's plans with them.
 *
 * The username is deliberately absent: it is what every device is already
 * signed in as, and for an imported account it is the id the school's own
 * directory handed out.
 */
function EditAccountDialog({
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
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Adopt the member's values only when the dialog changes identity — reading
  // them on every render would fight the person typing into the fields.
  React.useEffect(() => {
    if (!member) return;
    setFullName(member.full_name);
    setEmail(member.email ?? "");
    setError(null);
  }, [member]);

  const submit = () => {
    if (!member) return;
    if (!fullName.trim()) {
      setError("Nama penuh diperlukan.");
      return;
    }
    const value = email.trim();
    // The same shape the route and the database check, so a bad address is
    // caught where the administrator can still see which field they meant.
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("Emel tidak sah.");
      return;
    }
    setError(null);
    save(
      () => setProfile(member.user_id, fullName.trim(), value || null),
      "Maklumat akaun dikemas kini",
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sunting akaun</DialogTitle>
          <DialogDescription>
            {member
              ? `${member.username} · nama pada setiap RPH, dan emel untuk log masuk Google.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <div>
            <Label htmlFor="edit-account-name" required>
              Nama penuh
            </Label>
            <Input
              id="edit-account-name"
              value={fullName}
              autoComplete="off"
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="edit-account-email">Emel</Label>
            <Input
              id="edit-account-email"
              type="email"
              value={email}
              autoComplete="off"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pilihan"
            />
            <p className="mt-1.5 text-[11.5px] text-ink-4">
              Alamat yang dipautkan pada log masuk Google pertama kali. Nama pengguna tidak
              ditukar di sini — ia yang peranti sudah log masuk dengannya.
            </p>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button disabled={busy} onClick={submit}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
