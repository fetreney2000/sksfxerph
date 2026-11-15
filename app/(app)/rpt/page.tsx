"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Info, Link2, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import type { RptLink } from "@/app/api/rpt/route";
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
import { Input, Label } from "@/components/ui/field";
import { supabaseConfigured } from "@/lib/config";
import { useSession } from "@/lib/hooks/use-session";

/**
 * RPT Tahunan — the teacher's yearly plans, linked rather than stored.
 *
 * The file bytes never enter this app: an RPT lives in the teacher's own
 * Google Drive and only the link is kept here, titled per subject, so a GPK
 * or Guru Besar can open it from /sekolah. Server-only like the template
 * library — no Dexie store, because a Drive link is only usable online anyway.
 */
export default function RptPage() {
  const session = useSession();
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [confirming, setConfirming] = React.useState<RptLink | null>(null);

  const query = useQuery<{ items: RptLink[] }>({
    queryKey: ["rpt-links", session],
    queryFn: async () => {
      const res = await fetch("/api/rpt", { credentials: "same-origin" });
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: RptLink[] };
    },
    enabled: supabaseConfigured,
    retry: false,
  });

  const items = supabaseConfigured ? (query.data?.items ?? []) : [];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/rpt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title: title.trim(), url: url.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(body?.error ?? "Gagal menyimpan pautan.");
        return;
      }
      // Same title, new link: the row is updated, not duplicated — say so, or
      // the teacher reads one form and two possible outcomes.
      toast.success("Pautan RPT disimpan.");
      setTitle("");
      setUrl("");
      void query.refetch();
    } catch {
      toast.error("Rangkaian bermasalah. Cuba lagi.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirming) return;
    try {
      const res = await fetch(`/api/rpt?id=${confirming.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Gagal memadam pautan.");
      toast.success("Pautan dipadam.");
      void query.refetch();
    } catch {
      toast.error("Gagal memadam pautan.");
    } finally {
      setConfirming(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">RPT Tahunan</h2>
        <span className="h-px flex-1 bg-border" />
        <span className="num text-xs text-ink-3">Sesi {session}</span>
      </div>

      <div className="mb-4 flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft p-3 text-[12.5px] leading-[1.55] text-info-ink">
        <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
        <p>
          Fail RPT kekal dalam Google Drive anda — yang disimpan di sini hanya pautannya,
          mengikut mata pelajaran. Pastikan perkongsian fail ditetapkan kepada sesiapa yang
          mempunyai pautan boleh melihat, supaya GPK dan Guru Besar boleh membukanya dari
          Paparan Sekolah.
        </p>
      </div>

      {!supabaseConfigured ? (
        <Card>
          <CardContent className="py-10 text-center text-[13px] text-ink-4">
            Pautan RPT memerlukan mod disegerakkan — tiada pangkalan data ditetapkan.
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Tambah pautan</CardTitle>
              <CardDescription>
                Satu tajuk satu pautan. Menambah tajuk yang sama akan menggantikan pautan lama.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={save} noValidate className="grid gap-3">
                <div>
                  <Label htmlFor="rpt-title" required>
                    Tajuk
                  </Label>
                  <Input
                    id="rpt-title"
                    value={title}
                    autoComplete="off"
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="rpt-url" required>
                    Pautan Google Drive
                  </Label>
                  <Input
                    id="rpt-url"
                    type="url"
                    inputMode="url"
                    value={url}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={saving}>
                  {saving ? "Menyimpan…" : "Simpan pautan"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pautan saya</CardTitle>
              <CardDescription>
                {items.length === 0
                  ? "Belum ada pautan untuk sesi ini."
                  : `${items.length} pautan untuk sesi ini.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {items.length === 0 && (
                <p className="py-6 text-center text-[13px] text-ink-4">
                  Tampal pautan RPT anda di sebelah — GPK dan Guru Besar akan melihatnya di
                  Paparan Sekolah.
                </p>
              )}
              {items.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 px-3 py-2"
                >
                  <Link2
                    className="h-4 w-4 shrink-0 text-ink-4"
                    strokeWidth={1.9}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">
                      {link.title}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-4">{link.url}</span>
                  </span>
                  <Button size="sm" variant="ghost" asChild>
                    <a href={link.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                      <span className="sr-only">Buka {link.title}</span>
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Padam ${link.title}`}
                    onClick={() => setConfirming(link)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Padam pautan RPT?</DialogTitle>
            <DialogDescription>
              {confirming ? `“${confirming.title}” tidak lagi kelihatan kepada penyemak.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-[13px] text-ink-2">
              Fail dalam Google Drive anda tidak terjejas — yang dipadam hanya pautan di sini.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Batal
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Padam pautan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
