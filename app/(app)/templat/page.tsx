"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Template {
  id: string;
  title: string;
  sub: string;
  tag: "KSSR" | "KSSM" | "KPM";
  tone: "" | "g" | "p" | "a";
  uses?: number;
  author?: string;
}

const TEMPLATES: Template[] = [
  {
    id: "t1",
    title: "Matematik Tahun 5 · SK 3.1",
    sub: "Nombor hingga 100,000 · Menulis semula",
    tag: "KSSR",
    tone: "",
    uses: 24,
  },
  {
    id: "t2",
    title: "Sains Tahun 4 · Proses Mendengar",
    sub: "Sains & Teknologi · Standard 2.1",
    tag: "KSSR",
    tone: "g",
    uses: 11,
  },
  {
    id: "t3",
    title: "Bahasa Melayu Form 3 · Pengukuhan",
    sub: "KSSM · Menulis karangan pendek",
    tag: "KSSM",
    tone: "p",
    author: "Cikgu Suhaila",
  },
  {
    id: "t4",
    title: "Prasekolah · Aktiviti Literasi",
    sub: "Kurikulum Prasekolah KPM · Tema “Keluarga”",
    tag: "KPM",
    tone: "a",
    uses: 6,
  },
  {
    id: "t5",
    title: "Matematik Tahun 6 · Operasi Wang",
    sub: "KSSR Semakan · SK 5.4",
    tag: "KSSR",
    tone: "",
    uses: 18,
  },
];

const TONE_BAR = {
  "": "from-primary to-[#53b1fd]",
  g: "from-[#12b76a] to-[#6ce9a6]",
  p: "from-[#7a5af8] to-[#bdb7fe]",
  a: "from-[#dc6803] to-[#fec86b]",
} as const;

const FILTERS = ["Semua", "Saya", "Sekolah", "KPM"] as const;

export default function TemplatPage() {
  const router = useRouter();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("Semua");

  const visible = TEMPLATES.filter((t) =>
    filter === "Semua"
      ? true
      : filter === "KPM"
        ? t.tag === "KPM"
        : filter === "Saya"
          ? !t.author
          : Boolean(t.author),
  );

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
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((t) => (
          <Card
            key={t.id}
            className="group overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary-soft-2 hover:shadow-lg"
          >
            <span className={`block h-1.5 bg-gradient-to-r ${TONE_BAR[t.tone]}`} aria-hidden />
            <CardContent>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-[14.5px] leading-tight font-bold tracking-[-0.2px]">
                    {t.title}
                  </h3>
                  <p className="mt-1 text-xs text-ink-3">{t.sub}</p>
                </div>
                <Badge
                  variant={t.tag === "KPM" ? "warning" : t.tag === "KSSM" ? "neutral" : "info"}
                >
                  {t.tag}
                </Badge>
              </div>

              <div className="mt-3.5 flex gap-4 text-xs text-ink-3">
                {t.uses !== undefined && (
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

              <div className="mt-3.5 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    toast(`Templat “${t.title}” dimuatkan ke editor`);
                    router.push("/editor");
                  }}
                >
                  Guna templat
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => toast(`Pratonton: ${t.title}`)}
                >
                  Pratonton
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        <button
          type="button"
          onClick={() => toast("Cipta templat daripada RPH sedia ada atau mulakan dari kosong")}
          className="grid min-h-[172px] place-items-center rounded-[14px] border-2 border-dashed border-border-strong bg-surface-2 p-5 text-center transition-colors hover:border-primary hover:bg-primary-soft"
        >
          <span>
            <span className="mx-auto mb-2.5 grid h-10.5 w-10.5 place-items-center rounded-[11px] border border-primary-soft-2 bg-surface text-primary shadow-xs">
              <Plus className="h-5 w-5" strokeWidth={2} aria-hidden />
            </span>
            <span className="block text-sm font-bold">Cipta templat baharu</span>
            <span className="mt-1 block max-w-[230px] text-[12.5px] text-ink-3">
              Simpan mana-mana RPH sebagai templat untuk kelas lain atau sesi akan datang.
            </span>
          </span>
        </button>
      </div>
    </>
  );
}
