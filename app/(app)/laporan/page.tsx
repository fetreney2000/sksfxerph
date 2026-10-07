"use client";

import { FileSpreadsheet, FileText, Printer, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SCHOOL_STATS } from "@/lib/demo/review";

/**
 * Reporting & export.
 *
 * Two obligations meet here:
 *   • the teacher's need to hand a printed plan to a superior on request, and
 *   • Peraturan 8, Akta Pendidikan 1996 — the record must be producible for
 *     inspection. Every export is logged (see `export_file` in schema.sql).
 */
const EXPORTS = [
  {
    id: "week",
    icon: FileText,
    title: "RPH minggu semasa (PDF)",
    desc: "Semua RPH Minggu 6 mengikut format KPM, sedia untuk dicetak.",
    action: () => toast("Menjana PDF Minggu 6…"),
  },
  {
    id: "session",
    icon: FileSpreadsheet,
    title: "Ringkasan sesi (CSV)",
    desc: `Senarai semua RPH sesi 2026/2027 · ${SCHOOL_STATS.submitted} rekod.`,
    action: () => toast("Fail CSV dimuat turun"),
  },
  {
    id: "compliance",
    icon: Printer,
    title: "Laporan pematuhan sekolah",
    desc: "Prestasi mengikut guru, bidang dan minggu — untuk mesyuarat panitia.",
    action: () => toast("Laporan pematuhan dijana"),
  },
];

export default function LaporanPage() {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Laporan &amp; Eksport</h2>
        <span className="h-px flex-1 bg-border" />
        <Badge variant="success">Rekod statutory · Peraturan 8</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
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
                <Button onClick={e.action} className="w-full">
                  Jana
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
