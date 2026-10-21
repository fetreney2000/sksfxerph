"use client";

import { FileText, PenLine, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Reporting & export.
 *
 * Only what actually produces a document appears here, and each card takes
 * the teacher to the screen that does the work rather than pretending to do
 * it here. The export belongs with its context: the week's print needs the
 * week, and a DOCX needs the plan it is being made from.
 *
 * An earlier version offered CSV, ZIP and compliance-report buttons that
 * printed a success toast and generated nothing. On a page that opens by
 * citing a statutory obligation, a button that claims to have produced a
 * record and has not is worse than no button at all — it is a compliance
 * claim, not a feature claim.
 */
const EXPORTS = [
  {
    id: "week",
    icon: FileText,
    title: "RPH minggu semasa (PDF)",
    desc: "Cetak minggu menghasilkan halaman muka depan mingguan dan satu halaman setiap RPH. Simpan sebagai PDF melalui dialog cetak.",
    href: "/minggu",
    cta: "Buka Minggu Ini",
  },
  {
    id: "plan",
    icon: PenLine,
    title: "RPH tunggal (DOCX)",
    desc: "Buka RPH daripada Minggu Ini, kemudian eksport sebagai .docx yang boleh disunting dalam Word.",
    href: "/minggu",
    cta: "Pilih RPH",
  },
];

export default function LaporanPage() {
  const router = useRouter();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Laporan dan Eksport</h2>
        <span className="h-px flex-1 bg-border" />
        <Badge variant="neutral">Dua jenis eksport</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {EXPORTS.map((e) => {
          const Icon = e.icon;
          return (
            <Card key={e.id} className="flex flex-col overflow-hidden">
              <span className="h-1 bg-gradient-to-r from-primary to-[#53b1fd]" aria-hidden />
              <CardHeader className="pb-0">
                <span
                  className="grid h-10 w-10 place-items-center rounded-[11px] bg-primary-soft text-primary-ink"
                  aria-hidden
                >
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <CardTitle className="mb-1.5">{e.title}</CardTitle>
                <CardDescription className="mb-4 flex-1 leading-[1.55]">
                  {e.desc}
                </CardDescription>
                <Button onClick={() => router.push(e.href)} className="w-full">
                  {e.cta}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <ShieldCheck className="h-4.5 w-4.5 text-success-ink" strokeWidth={1.9} aria-hidden />
          <CardTitle>Kenapa eksport ini wujud</CardTitle>
        </CardHeader>
        <CardContent className="text-[13px] leading-[1.6] text-ink-2">
          <p className="mb-3">
            RPH ialah dokumen utama yang disediakan guru di bawah{" "}
            <b>Peraturan 8, Peraturan-Peraturan Pendidikan (Kurikulum Kebangsaan) 1997</b> dan
            perlu disediakan untuk pemeriksaan oleh Ketua Pendaftar. Sistem ini menyimpan setiap
            versi dalam <code className="rounded bg-surface-3 px-1">rph_revision</code> supaya
            dokumen yang dihantar ke pemeriksaan ialah dokumen yang sama seperti yang ditulis.
          </p>
          <p className="text-ink-3">
            Mengikut Surat Siaran KPM Bil. 2/2025, guru <b>tidak perlu mencetak</b> e-RPH setiap
            minggu — hanya apabila diminta.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
