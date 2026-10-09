"use client";

import { useQuery } from "@tanstack/react-query";
import { ImageUp, Save, School as SchoolIcon } from "lucide-react";
import Image from "next/image";
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
import { FieldError, Input, Label } from "@/components/ui/field";
import { getSchool, type SchoolIdentity, setSchool as saveSchool } from "@/lib/client/admin";
import { useAdminSave } from "@/lib/hooks/use-admin-save";
import { setSchool as adoptSchool, placeFrom } from "@/lib/school";

/**
 * Tab 5 — the school's own identity: name, district/state, motto, crest.
 *
 * Everything on this form is what the login screen, sidebar, breadcrumb, ⌘K,
 * the live preview and the printed RPH all read — so the preview on the right
 * is not decoration. Changing a school's name is the one edit with no undo
 * button in the user's mind: seeing it in place, in the same lockup the app
 * will use, is what makes the change deliberate rather than a leap of faith.
 *
 * `kod_sekolah` is shown but not editable, and that is a constraint rather
 * than an omission: it is `school`'s natural key and it also has to equal
 * `NEXT_PUBLIC_SCHOOL_CODE`, which is compiled into the build. Editing one
 * without the other would leave the deployment identifying itself as a school
 * it is no longer.
 */

interface Form {
  nama: string;
  ppd: string;
  jpn: string;
  motto: string;
  logo_url: string | null;
}

const toForm = (s: SchoolIdentity): Form => ({
  nama: s.nama,
  ppd: s.ppd ?? "",
  jpn: s.jpn ?? "",
  motto: s.motto ?? "",
  logo_url: s.logo_url,
});

export function SchoolTab() {
  const { busy, save } = useAdminSave();

  const query = useQuery({
    queryKey: ["admin-school"],
    queryFn: getSchool,
    retry: false,
  });

  const stored = query.data?.school ?? null;

  const [form, setForm] = React.useState<Form | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Adopt the stored values once. Re-adopting on every refetch would overwrite
  // what the administrator is in the middle of typing the moment a response
  // lands — the same rule the settings form follows.
  React.useEffect(() => {
    if (!stored || form !== null) return;
    setForm(toForm(stored));
  }, [stored, form]);

  // A local object URL for a chosen file, revoked when replaced or unmounted —
  // otherwise every pick leaks a blob for the life of the tab.
  React.useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const active = form ?? { nama: "", ppd: "", jpn: "", motto: "", logo_url: null };
  const logoSrc = preview ?? active.logo_url ?? "/logo.png";

  const submit = () => {
    if (!active.nama.trim()) {
      setError("Nama sekolah diperlukan.");
      return;
    }
    setError(null);

    const data = new FormData();
    data.set("nama", active.nama.trim());
    data.set("ppd", active.ppd.trim());
    data.set("jpn", active.jpn.trim());
    data.set("motto", active.motto.trim());
    if (active.logo_url) data.set("logo_url", active.logo_url);
    if (file) data.set("logo", file);

    save(
      async () => {
        const { school: updated } = await saveSchool(data);
        if (!updated) return;

        // The shell reads these through `useSchool()`, so nothing re-renders
        // with the new identity until the store is told. Doing it here rather
        // than waiting for the next navigation is the difference between an
        // edit that appears to work and one that appears to be ignored.
        adoptSchool({
          name: updated.nama,
          place: placeFrom(updated.ppd, updated.jpn),
          motto: updated.motto ?? "",
          logo: updated.logo_url ?? "/logo.png",
        });
        setForm(toForm(updated));
        await query.refetch();
      },
      "Maklumat sekolah dikemas kini",
      () => setFile(null),
    );
  };

  if (query.isLoading || (!stored && !query.isError)) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-[12.5px] text-ink-4">
          Memuatkan maklumat sekolah…
        </CardContent>
      </Card>
    );
  }

  if (!stored || !form) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-[12.5px] text-ink-4">
          Maklumat sekolah tidak dapat dimuatkan.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <SchoolIcon className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
          <div>
            <CardTitle>Maklumat sekolah</CardTitle>
            <CardDescription>
              Dipaparkan pada skrin log masuk, navigasi, pratonton dan dokumen RPH yang dicetak.
            </CardDescription>
          </div>
          <Badge className="ml-auto" variant="neutral">
            {stored.kod_sekolah}
          </Badge>
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="sch-name" required>
                Nama sekolah
              </Label>
              <Input
                id="sch-name"
                value={active.nama}
                maxLength={160}
                onChange={(e) => setForm({ ...active, nama: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="sch-ppd">Daerah (PPD)</Label>
              <Input
                id="sch-ppd"
                value={active.ppd}
                maxLength={120}
                placeholder="PPD Keningau"
                onChange={(e) => setForm({ ...active, ppd: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="sch-jpn">Negeri (JPN)</Label>
              <Input
                id="sch-jpn"
                value={active.jpn}
                maxLength={120}
                placeholder="JPN Sabah"
                onChange={(e) => setForm({ ...active, jpn: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="sch-motto">Moto sekolah</Label>
              <Input
                id="sch-motto"
                value={active.motto}
                maxLength={200}
                placeholder="Bersatu Kita Teguh"
                onChange={(e) => setForm({ ...active, motto: e.target.value })}
              />
              <p className="mt-1.5 text-[11.5px] text-ink-4">
                Dipaparkan pada skrin log masuk. Kosongkan untuk memulangkan moto lalai.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="sch-logo">Lambang sekolah</Label>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  id="sch-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="max-w-[300px] py-2 text-[12.5px]"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {(active.logo_url || file) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setFile(null);
                      setForm({ ...active, logo_url: null });
                    }}
                  >
                    Gunakan logo asal
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-[11.5px] text-ink-4">
                PNG, JPG atau WebP · maksimum 2 MB. Muat naik menggantikan lambang sedia ada.
              </p>
            </div>
          </div>

          {error && <FieldError>{error}</FieldError>}

          <div>
            <Button disabled={busy} onClick={submit}>
              <Save className="h-4 w-4" strokeWidth={1.9} aria-hidden />
              Simpan maklumat sekolah
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Live preview ─────────────────────────────────────────────────── */}
      <Card className="h-fit">
        <CardHeader>
          <ImageUp className="h-4 w-4 text-ink-4" strokeWidth={1.9} aria-hidden />
          <div>
            <CardTitle>Pratonton</CardTitle>
            <CardDescription>Cara jenama akan kelihatan di seluruh aplikasi.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-3 rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-gradient-to-b from-[#0c1d33] to-[#0a1729] p-4">
            <Image
              src={logoSrc}
              alt=""
              width={512}
              height={512}
              unoptimized={Boolean(preview)}
              className="h-12 w-12 shrink-0 rounded-[10px] bg-white object-contain p-0.5"
            />
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-bold text-white">
                {active.nama || "Nama sekolah"}
              </span>
              <span className="block truncate text-[11px] text-[#6d7f99]">
                Rancangan Pengajaran Harian
              </span>
            </span>
          </div>

          <div className="rounded-[12px] border border-border bg-surface p-4 text-center">
            <Image
              src={logoSrc}
              alt=""
              width={512}
              height={512}
              unoptimized={Boolean(preview)}
              className="mx-auto h-24 w-24 rounded-[10px] bg-white object-contain p-1 shadow-xs"
            />
            <p className="mt-3 text-[11px] font-bold tracking-[3px] text-ink-4 uppercase">
              {placeFrom(active.ppd || null, active.jpn || null)}
            </p>
            <p className="mt-1.5 text-[17px] font-extrabold tracking-[-0.4px]">
              {active.nama || "Nama sekolah"}
            </p>
            {active.motto && (
              <p className="mt-2 inline-flex rounded-full border border-warning-line bg-warning-soft px-3 py-1 text-[11.5px] font-semibold text-warning-ink">
                {active.motto}
              </p>
            )}
          </div>

          <p className="text-[11.5px] leading-[1.55] text-ink-4">
            Perubahan berkuat kuasa untuk semua orang selepas halaman dimuat semula, tanpa perlu
            membina semula aplikasi.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
