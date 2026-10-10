"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarCheck,
  LayoutGrid,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Overview } from "@/app/api/admin/overview/route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableContainer } from "@/components/ui/table";
import { can, type Permission, permissionsFor } from "@/lib/auth/permissions";
import { supabaseConfigured } from "@/lib/config";
import { ms } from "@/lib/i18n/ms";
import { MEMBER_ROLES, type MemberRole } from "@/lib/types";

/**
 * `/utama` — the Administrator's home.
 *
 * Not a teacher's dashboard with the numbers swapped: an administrator does not
 * write plans, so "your RPH this week" would be a card permanently at zero.
 * What they are actually accountable for is the *school* — how many teachers
 * are registered, how much of the app is configured, and whether the week's
 * submissions are landing — plus the one thing only they need: a map of who can
 * do what, which is the definition of the roles they hand out.
 *
 * The matrix is derived from `permissionsFor`, not transcribed. A hard-coded
 * table would drift from `lib/auth/permissions.ts` the first time a permission
 * moves, and this screen exists precisely so an administrator can answer "what
 * will happen if I make this person a GPK?" without reading source.
 */

const PERMISSION_LABEL: Record<Permission, string> = {
  rph: "RPH sendiri",
  semak: "Semakan RPH",
  pantau: "Pantauan sekolah",
  laporan: "Laporan & eksport",
  audit: "Log audit",
  templat: "Perpustakaan templat",
  pentadbir: "Tetapan aplikasi",
};

const ORDER: Permission[] = [
  "rph",
  "semak",
  "pantau",
  "laporan",
  "audit",
  "templat",
  "pentadbir",
];

interface Stat {
  label: string;
  value: string | number;
  hint: string;
  icon: ReactNode;
}

export default function UtamaPage() {
  const overview = useQuery<{ overview: Overview | null }>({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/overview", { credentials: "same-origin" });
      if (!res.ok) return { overview: null };
      return (await res.json()) as { overview: Overview | null };
    },
    enabled: supabaseConfigured,
    retry: false,
    staleTime: 30_000,
  });

  const o = overview.data?.overview ?? null;

  if (!supabaseConfigured) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-[13.5px] font-semibold">
            Papan pemuka pentadbir memerlukan mod disegerakkan.
          </p>
          <p className="mx-auto mt-1.5 max-w-[460px] text-[12.5px] text-ink-3">
            Mod setempat hanya mempunyai akaun demo dan tiada pangkalan data untuk dikira.
          </p>
        </CardContent>
      </Card>
    );
  }

  const stats: Stat[] = [
    {
      label: "Guru berdaftar",
      value: o?.members.teachers ?? "—",
      hint: `${o?.members.total ?? 0} akaun keseluruhan`,
      icon: <UserCheck className="h-4 w-4" strokeWidth={1.9} aria-hidden />,
    },
    {
      label: "Kelas",
      value: o?.classes ?? "—",
      hint: "sesi semasa",
      icon: <LayoutGrid className="h-4 w-4" strokeWidth={1.9} aria-hidden />,
    },
    {
      label: "Mata pelajaran",
      value: o?.subjects ?? "—",
      hint: "ditawarkan",
      icon: <BookOpen className="h-4 w-4" strokeWidth={1.9} aria-hidden />,
    },
    {
      label: "Templat",
      value: o?.templates ?? "—",
      hint: "dalam perpustakaan",
      icon: <Users className="h-4 w-4" strokeWidth={1.9} aria-hidden />,
    },
  ];

  const weekStats: Stat[] = [
    {
      label: "RPH dihantar · minggu ini",
      value: o?.week ? `${o.week.submitted}/${o.week.expected}` : "—",
      hint: `${o?.week?.compliance ?? 0}% pematuhan sekolah`,
      icon: <CalendarCheck className="h-4 w-4" strokeWidth={1.9} aria-hidden />,
    },
    {
      label: "Diluluskan",
      value: o?.week?.approved ?? "—",
      hint: `${o?.week?.returned_t ?? 0} dikembalikan · ${o?.week?.drafts ?? 0} draf`,
      icon: <ShieldCheck className="h-4 w-4" strokeWidth={1.9} aria-hidden />,
    },
  ];

  const roles = MEMBER_ROLES.filter((r) => r !== "system");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Papan pemuka pentadbir</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            Ringkasan sekolah dan apa yang setiap peranan boleh lakukan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/pentadbiran"
            className="rounded-[9px] border border-border-strong bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink-2 shadow-xs transition-colors hover:bg-surface-3"
          >
            Urus akaun &amp; tetapan
          </Link>
          <Link
            href="/templat"
            className="rounded-[9px] border border-border-strong bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink-2 shadow-xs transition-colors hover:bg-surface-3"
          >
            Perpustakaan templat
          </Link>
        </div>
      </div>

      {/* ── The school, in numbers ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-ink-4">{s.icon}</div>
              <p className="mt-2 text-[11.5px] font-semibold tracking-[0.6px] text-ink-4 uppercase">
                {s.label}
              </p>
              <p className="mt-1 text-[26px] leading-none font-extrabold tracking-[-0.8px]">
                {s.value}
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-4">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {weekStats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-ink-4">{s.icon}</div>
              <p className="mt-2 text-[11.5px] font-semibold tracking-[0.6px] text-ink-4 uppercase">
                {s.label}
              </p>
              <p className="mt-1 text-[26px] leading-none font-extrabold tracking-[-0.8px]">
                {s.value}
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-4">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Matriks peranan ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <ShieldCheck className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
          <div>
            <CardTitle>Matriks peranan</CardTitle>
            <p className="text-xs text-ink-3">
              Apa yang setiap peranan boleh lakukan. Inilah yang menentukan paparan apabila anda
              mengubah peranan seseorang.
            </p>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <TableContainer>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-surface-2">
                  <th className="border-b border-border px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.7px] text-ink-4 uppercase">
                    Peranan
                  </th>
                  {ORDER.map((p) => (
                    <th
                      key={p}
                      className="border-b border-border px-2.5 py-2.5 text-center text-[11.5px] font-bold tracking-[0.4px] text-ink-4"
                    >
                      {PERMISSION_LABEL[p]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-semibold text-ink">{ms.roles[role]}</td>
                    {ORDER.map((p) => {
                      const allowed = can(role, p);
                      return (
                        <td key={p} className="px-2.5 py-2.5 text-center">
                          {allowed ? (
                            <span
                              role="img"
                              className="inline-grid h-5 w-5 place-items-center rounded-full bg-success-soft text-[12px] font-bold text-success-ink"
                              aria-label={`Boleh: ${PERMISSION_LABEL[p]}`}
                            >
                              ✓
                            </span>
                          ) : (
                            <span
                              role="img"
                              className="inline-block h-1.5 w-1.5 rounded-full bg-border-strong"
                              aria-label={`Tidak: ${PERMISSION_LABEL[p]}`}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* ── What each role actually holds, in words ────────────────────── */}
      <Card>
        <CardHeader>
          <Users className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
          <div>
            <CardTitle>Ringkasan kebenaran</CardTitle>
            <p className="text-xs text-ink-3">
              Senarai tepat yang digunakan oleh aplikasi — sama seperti matriks di atas.
            </p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2.5">
          {roles.map((role: MemberRole) => (
            <div key={role} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="w-[150px] shrink-0 text-[12.5px] font-semibold text-ink">
                {ms.roles[role]}
              </span>
              <span className="text-[12.5px] text-ink-3">
                {permissionsFor(role)
                  .map((p) => PERMISSION_LABEL[p])
                  .join(" · ") || "Tiada kebenaran"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
