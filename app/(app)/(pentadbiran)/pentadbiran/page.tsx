"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound, School, Users } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
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
import { Input, Label, Select } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabaseConfigured } from "@/lib/config";
import { ms } from "@/lib/i18n/ms";
import { MEMBER_ROLES, type MemberRole } from "@/lib/types";

/**
 * Pentadbiran — who may use the app, and under what rule.
 *
 * Administrator only, three times over: the layout redirects, the API refuses
 * (`requireAdministrator` → `erph.admin_set_member`), and the role itself sits
 * outside `is_staff` in SQL so nothing here can be reached by grading.
 *
 * Local mode has no backend and every write path returns 503, so the page says
 * so rather than rendering controls that cannot work.
 */
interface Member {
  user_id: string;
  username: string;
  full_name: string;
  email: string | null;
  role: MemberRole;
  is_active: boolean;
}

interface Setting {
  current_session: string;
  submit_weekday: number;
  submit_time: string;
  require_complete: boolean;
}

/** Roles an administrator may hand out — `system` is a service account. */
const ASSIGNABLE = MEMBER_ROLES.filter((r) => r !== "system");

const WEEKDAYS: [number, string][] = [
  [1, "Isnin"],
  [2, "Selasa"],
  [3, "Rabu"],
  [4, "Khamis"],
  [5, "Jumaat"],
  [6, "Sabtu"],
  [7, "Ahad"],
];

async function patch(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Gagal menyimpan");
  }
}

export default function PentadbiranPage() {
  const { id: myId } = useUser();
  const [tab, setTab] = React.useState<"akaun" | "tetapan">("akaun");
  const [tick, setTick] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  const accounts = useQuery<{ items: Member[] }>({
    queryKey: ["admin-accounts", tick],
    queryFn: async () =>
      (await fetch("/api/admin/accounts", { credentials: "same-origin" }).then((r) =>
        r.json(),
      )) as { items: Member[] },
    enabled: supabaseConfigured,
    retry: false,
  });

  const settings = useQuery<{ setting: Setting | null }>({
    queryKey: ["admin-settings", tick],
    queryFn: async () =>
      (await fetch("/api/admin/settings", { credentials: "same-origin" }).then((r) =>
        r.json(),
      )) as { setting: Setting | null },
    enabled: supabaseConfigured,
    retry: false,
  });

  const [weekday, setWeekday] = React.useState(5);
  const [time, setTime] = React.useState("16:00");
  const [requireComplete, setRequireComplete] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);

  // The form is an editor, not a mirror: adopt the stored values once, then
  // let the administrator change them without the server overwriting mid-edit.
  React.useEffect(() => {
    const s = settings.data?.setting;
    if (!s || loaded) return;
    setWeekday(s.submit_weekday);
    setTime(s.submit_time.slice(0, 5));
    setRequireComplete(s.require_complete);
    setLoaded(true);
  }, [settings.data, loaded]);

  const save = (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    fn()
      .then(() => {
        toast.success(ok);
        setTick((t) => t + 1);
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Gagal menyimpan"),
      )
      .finally(() => setBusy(false));
  };

  if (!supabaseConfigured) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-[13.5px] font-semibold">
            Pentadbiran memerlukan mod disegerakkan.
          </p>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[12.5px] text-ink-3">
            Mod setempat hanya mempunyai akaun demo dan tiada pangkalan data untuk disesuaikan.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Urus eRPH</h2>
        <span className="h-px flex-1 bg-border" />
        <Tabs value={tab} onValueChange={(v) => setTab(v as "akaun" | "tetapan")}>
          <TabsList>
            <TabsTrigger value="akaun">Akaun &amp; peranan</TabsTrigger>
            <TabsTrigger value="tetapan">Sesi &amp; tarikh akhir</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "akaun" | "tetapan")}>
        {/* ── Akaun ─────────────────────────────────────────────────────── */}
        <TabsContent value="akaun">
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
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-surface-2">
                    {["Nama", "Peranan", "Status", ""].map((h) => (
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
                  {(accounts.data?.items ?? []).map((m) => {
                    const own = m.user_id === myId;
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
                            onChange={(e) =>
                              save(
                                () =>
                                  patch("/api/admin/accounts", {
                                    userId: m.user_id,
                                    role: e.target.value,
                                    isActive: m.is_active,
                                  }),
                                `Peranan ${m.full_name} dikemas kini`,
                              )
                            }
                          >
                            {ASSIGNABLE.map((r) => (
                              <option key={r} value={r}>
                                {ms.roles[r]}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={m.is_active ? "success" : "neutral"}>
                            {m.is_active ? "Aktif" : "Dinyahaktif"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || own}
                            title={
                              own ? "Anda tidak boleh menyahaktifkan akaun sendiri" : undefined
                            }
                            onClick={() =>
                              save(
                                () =>
                                  patch("/api/admin/accounts", {
                                    userId: m.user_id,
                                    role: m.role,
                                    isActive: !m.is_active,
                                  }),
                                m.is_active
                                  ? `${m.full_name} dinyahaktifkan`
                                  : `${m.full_name} diaktifkan`,
                              )
                            }
                          >
                            {m.is_active ? "Nyahaktif" : "Aktifkan"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {(accounts.data?.items ?? []).length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-[12.5px] text-ink-4"
                      >
                        Tiada akaun ditemui.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tetapan ───────────────────────────────────────────────────── */}
        <TabsContent value="tetapan">
          <Card>
            <CardHeader>
              <School className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
              <div>
                <CardTitle>Sesi &amp; tarikh akhir</CardTitle>
                <CardDescription>
                  Peraturan penghantaran untuk keseluruhan sekolah.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="f-sesi">Sesi semasa</Label>
                <Input
                  id="f-sesi"
                  value={settings.data?.setting?.current_session ?? ""}
                  readOnly
                  className="num"
                />
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

              <div className="sm:col-span-3">
                <label className="flex items-center gap-2.5 text-[13px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={requireComplete}
                    onChange={(e) => setRequireComplete(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                  />
                  Halang penghantaran sehingga keluargaan 100%
                </label>
              </div>

              <div className="sm:col-span-3">
                <Button
                  disabled={busy || !loaded}
                  onClick={() =>
                    save(
                      () =>
                        patch("/api/admin/settings", {
                          submitWeekday: weekday,
                          submitTime: time,
                          requireComplete,
                        }),
                      "Tetapan sekolah dikemas kini",
                    )
                  }
                >
                  <KeyRound className="h-4 w-4" strokeWidth={1.9} aria-hidden />
                  Simpan tetapan
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
