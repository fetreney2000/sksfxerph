"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useUser } from "@/components/shell/user-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { can } from "@/lib/auth/permissions";
import { supabaseConfigured } from "@/lib/config";
import { useAdminSave } from "@/lib/hooks/use-admin-save";
import { useSchoolSubjects } from "@/lib/hooks/use-school-data";
import type { Curriculum } from "@/lib/types";

/**
 * Perpustakaan templat — with create, read, update and delete.
 *
 * Until now the five cards were a hard-coded array, "Guna templat" merely
 * toasted, and the "create" tile actually opened a blank *eRPH*. Every one of
 * those has been replaced by something that works against `erph.rph_template`.
 *
 * **Cipta** and **Sunting** both go to `/templat/baru`, which is the RPH
 * editor — the first without a template behind it, the second with one. A
 * template's whole value is the plan inside it, so the screen that writes one
 * is the screen that writes a plan, and there is one surface for a template's
 * content rather than a dialog that could only ever rename it. Which of the
 * two it is, the penyunting knows from `?edit=`.
 *
 * "Guna templat" navigates to `/editor?template=<id>` rather than writing a
 * document: the template's payload is loaded into the unsaved plan, so it can
 * be read and edited before anything exists. That is what makes CRUD here safe
 * — using the wrong template costs a navigation, not a row to clean up.
 *
 * Local mode keeps the bundled fixtures (read-only, as with everything else
 * that needs a database): they are what makes the screen demoable offline, and
 * pretending to edit them would be worse than saying nothing.
 */

interface Template {
  id: string;
  title: string;
  sub: string;
  tag: string;
  tone: string;
  uses: number;
  author?: string;
  subjectCode: string | null;
  tahap: string | null;
  curriculum: Curriculum | null;
  visibility: "private" | "school" | "system";
  ownerId: string | null;
  /** Fixture with no row behind it — CRUD does not apply. */
  local: boolean;
}

/** Local-mode fixtures. Same cards, no database, so nothing can be edited. */
const FIXTURES: Template[] = [
  {
    id: "t1",
    title: "Matematik Tahun 5 · SK 3.1",
    sub: "Nombor hingga 100,000 · Menulis semula",
    tag: "KSSR",
    tone: "",
    uses: 24,
    subjectCode: "MAT",
    tahap: "Tahun 5",
    curriculum: "KSSR",
    visibility: "system",
    ownerId: null,
    local: true,
  },
  {
    id: "t2",
    title: "Sains Tahun 4 · Proses Mendengar",
    sub: "Sains dan Teknologi · Standard 2.1",
    tag: "KSSR",
    tone: "g",
    uses: 11,
    subjectCode: "SAIN",
    tahap: "Tahun 4",
    curriculum: "KSSR",
    visibility: "system",
    ownerId: null,
    local: true,
  },
  {
    id: "t3",
    title: "Bahasa Melayu Form 3 · Pengukuhan",
    sub: "KSSM · Menulis karangan pendek",
    tag: "KSSM",
    tone: "p",
    uses: 0,
    author: "Cikgu Suhaila",
    subjectCode: "BM",
    tahap: "Tingkatan 3",
    curriculum: "KSSM",
    visibility: "school",
    ownerId: "someone-else",
    local: true,
  },
  {
    id: "t4",
    title: "Prasekolah · Aktiviti Literasi",
    sub: "Kurikulum Prasekolah KPM · Tema “Keluarga”",
    tag: "KPM",
    tone: "a",
    uses: 6,
    subjectCode: null,
    tahap: "Prasekolah",
    curriculum: "PRASEKOLAH",
    visibility: "system",
    ownerId: null,
    local: true,
  },
  {
    id: "t5",
    title: "Matematik Tahun 6 · Operasi Wang",
    sub: "KSSR Semakan · SK 5.4",
    tag: "KSSR",
    tone: "",
    uses: 18,
    subjectCode: "MAT",
    tahap: "Tahun 6",
    curriculum: "KSSR",
    visibility: "system",
    ownerId: null,
    local: true,
  },
];

const TONE_BAR: Record<string, string> = {
  "": "from-primary to-[#53b1fd]",
  g: "from-[#12b76a] to-[#6ce9a6]",
  p: "from-[#7a5af8] to-[#bdb7fe]",
  a: "from-[#dc6803] to-[#fec86b]",
};

const TONES = ["", "g", "p", "a"];
const FILTERS = ["Semua", "Saya", "Sekolah", "KPM"] as const;

const VISIBILITY_LABEL = { system: "KPM", school: "Sekolah", private: "Saya" } as const;

interface ApiTemplate {
  id: string;
  owner_id: string | null;
  title: string;
  subject_code: string | null;
  tahap: string | null;
  curriculum: Curriculum | null;
  visibility: "private" | "school" | "system";
  use_count: number;
  owner: { full_name: string } | null;
}

export default function TemplatPage() {
  const router = useRouter();
  const { id: myId, role } = useUser();
  const { busy, save } = useAdminSave();
  const { items: subjects } = useSchoolSubjects();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("Semua");
  const [confirming, setConfirming] = React.useState<Template | null>(null);

  const query = useQuery<{ items: ApiTemplate[] }>({
    queryKey: ["templates"],
    queryFn: async () => {
      const res = await fetch("/api/templates", { credentials: "same-origin" });
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: ApiTemplate[] };
    },
    enabled: supabaseConfigured,
    retry: false,
  });

  const subjectName = (code: string | null) =>
    code ? (subjects.find((s) => s.code === code)?.nama ?? code) : null;

  const rows: Template[] = supabaseConfigured
    ? (query.data?.items ?? []).map((t, i) => ({
        id: t.id,
        title: t.title,
        sub: [subjectName(t.subject_code), t.tahap].filter(Boolean).join(" · "),
        tag: VISIBILITY_LABEL[t.visibility],
        tone: TONES[i % TONES.length] ?? "",
        uses: t.use_count,
        author: t.owner?.full_name,
        subjectCode: t.subject_code,
        tahap: t.tahap,
        curriculum: t.curriculum,
        visibility: t.visibility,
        ownerId: t.owner_id,
        local: false,
      }))
    : FIXTURES;

  const visible = rows.filter((t) =>
    filter === "Semua"
      ? true
      : filter === "Saya"
        ? t.ownerId === myId || t.visibility === "private"
        : filter === "Sekolah"
          ? t.visibility === "school"
          : t.visibility === "system",
  );

  const refresh = () => void query.refetch();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Perpustakaan templat</h2>
        <span className="h-px flex-1 bg-border" />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={
                "rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors " +
                (filter === f
                  ? "border-ink bg-ink text-surface"
                  : "border-border-strong bg-surface text-ink-2 hover:bg-surface-3")
              }
            >
              {f}
            </button>
          ))}
          {/* Create needs a database to write to, so offering it in local mode
              only ever ended in a 503 — and now it costs a whole plan written
              before that happens. */}
          <Button
            size="sm"
            disabled={!supabaseConfigured}
            title={
              supabaseConfigured ? undefined : "Cipta templat memerlukan mod disegerakkan."
            }
            onClick={() => router.push("/templat/baru")}
          >
            <Plus className="h-4 w-4" strokeWidth={1.9} aria-hidden /> Cipta templat
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((t) => {
          const mine = t.ownerId === myId;
          const editable = !t.local && (mine || can(role, "pentadbir"));
          return (
            <Card
              key={t.id}
              className="group overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary-soft-2 hover:shadow-lg"
            >
              <span
                className={`block h-1.5 bg-gradient-to-r ${TONE_BAR[t.tone] ?? TONE_BAR[""]}`}
                aria-hidden
              />
              <CardContent>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[14.5px] leading-tight font-bold tracking-[-0.2px]">
                      {t.title}
                    </h3>
                    <p className="mt-1 text-xs text-ink-3">{t.sub}</p>
                  </div>
                  <Badge
                    variant={
                      t.visibility === "system"
                        ? "warning"
                        : t.visibility === "school"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {t.tag}
                  </Badge>
                </div>

                <div className="mt-3.5 flex gap-4 text-xs text-ink-3">
                  {t.uses > 0 && (
                    <span>
                      Digunakan <b className="num text-ink">{t.uses}×</b>
                    </span>
                  )}
                  {t.author && (
                    <span>
                      Kongsi oleh <b className="text-ink">{t.author}</b>
                    </span>
                  )}
                </div>

                <div className="mt-3.5 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => router.push(`/editor?template=${t.id}`)}
                  >
                    <Wand2 className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                    Guna templat
                  </Button>
                  {editable && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Sunting ${t.title}`}
                        onClick={() => router.push(`/templat/baru?edit=${t.id}`)}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Padam ${t.title}`}
                        onClick={() => setConfirming(t)}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {visible.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-[12.5px] text-ink-4">
              Tiada templat dalam tapisan ini.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Padam templat?</DialogTitle>
            <DialogDescription>
              {confirming
                ? `“${confirming.title}” akan dipadam dan tidak boleh dipulihkan.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-[13px] text-ink-3">
              Rancangan yang pernah dibuat daripada templat ini tidak terjejas — hanya templat
              itu sendiri dipadam.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                const target = confirming;
                if (!target) return;
                save(
                  async () => {
                    const res = await fetch(`/api/templates?id=${target.id}`, {
                      method: "DELETE",
                      credentials: "same-origin",
                    });
                    if (!res.ok) {
                      const body = (await res.json().catch(() => null)) as {
                        error?: string;
                      } | null;
                      throw new Error(body?.error ?? "Gagal memadam");
                    }
                  },
                  "Templat dipadam",
                  () => {
                    setConfirming(null);
                    refresh();
                  },
                );
              }}
            >
              Padam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
