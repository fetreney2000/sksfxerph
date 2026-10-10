import type * as React from "react";
import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { SignatureSeal } from "@/components/rph/signature-seal";
import { cn } from "@/lib/cn";
import { hariName, weekdayIndex, weekRangeLabel } from "@/lib/date";
import type { SignatureState } from "@/lib/hooks/use-signature";
import type { RphPayload } from "@/lib/schemas/rph";
import { temaLengkap } from "@/lib/schemas/rph";
import { currentSchool } from "@/lib/school";

/**
 * The school's RPH, as it is actually submitted.
 *
 * Built against the template this school sends to its district — one table,
 * pale-green label cells, a fixed set of rows — rather than the generic KPM
 * form. The differences are the ones a teacher would notice immediately if
 * they were wrong: activities are a **list of names** (with indented
 * sub-items) rather than a timed table, **Kriteria Kejayaan** has its own row,
 * and there is no EMK, KBAT or Intervensi section because the printed form has
 * none.
 *
 * Rendered from the same JSON as the editor — one source of truth, so what a
 * teacher sees on screen is what prints and what the reviewer grades. This is
 * what has to survive inspection under Peraturan 8, Akta Pendidikan 1996.
 *
 * The signature is passed in rather than fetched here: this component is also
 * rendered on the export path, where the caller has already verified it, and a
 * second round trip would be a second failure mode for something that has to be
 * on the page.
 */

/** Label cell — the pale green the school's form uses. Shared with the cover
 *  sheet: if the district's green ever changes, it changes in one place. */
export const LABEL_BG = "#d9ead3";
export const RULE = "#a6a6a6";

export function Label({ children, span = 1 }: { children: React.ReactNode; span?: number }) {
  return (
    <td
      colSpan={span}
      className="border px-2.5 py-1.5 text-right align-middle font-medium"
      style={{ background: LABEL_BG, borderColor: RULE, width: span === 1 ? "20%" : undefined }}
    >
      {children}
    </td>
  );
}

export function Value({ children, span = 1 }: { children: React.ReactNode; span?: number }) {
  return (
    <td
      colSpan={span}
      className="border px-2.5 py-1.5 align-middle whitespace-pre-wrap break-words"
      style={{ borderColor: RULE }}
    >
      {children}
    </td>
  );
}

/** Empty cells print as a dash, the way the paper form does. */
const or = (s: string) => (s.trim() ? s.trim() : "—");

interface Props {
  payload: RphPayload;
  /** CSS class for the sheet itself — not the school's class. */
  className?: string;
  teacherName?: string;
  schoolName?: string;
  session: string;
  planClassName?: string;
  subjectName?: string;
  planDate?: string;
  slotTime?: string;
  slotTimeEnd?: string;
  weekNo?: number;
  /** Verified material, or null when the plan carries no seal. */
  signature?: SignaturePayload | null;
  signatureState?: SignatureState;
}

export function RphPaper({
  payload,
  className: sheetClass,
  teacherName = "Nurul Aisyah binti Rahim",
  schoolName = currentSchool().name,
  session,
  planClassName,
  subjectName,
  planDate,
  slotTime = "07:30",
  slotTimeEnd = "12:40",
  weekNo,
  signature,
  signatureState = "none",
}: Props) {
  // "2. Isnin" — the school's form numbers the day, and derives it from the
  // date rather than asking, so a plan cannot claim a Monday that is a Tuesday.
  const hari = planDate ? `${weekdayIndex(planDate)}. ${hariName(planDate)}` : "—";

  return (
    <article
      className={cn(
        "rounded-lg bg-white p-6 text-[12.5px] leading-[1.5] text-[#1d2939] shadow-lg",
        sheetClass,
      )}
    >
      {/* Faint identifiers, as the paper form prints them: a page separated
          from its week should still say which plan it is. */}
      <p className="text-center text-[10px] tracking-[0.4px] text-[#b0b7c3]">
        {schoolName} · {session}
        {weekNo ? ` · ${weekRangeLabel(weekNo)}` : ""}
      </p>

      <h2 className="mt-2 mb-3 text-center text-[17px] font-normal tracking-[0.3px]">
        RANCANGAN PENGAJARAN HARIAN
      </h2>

      <table
        className="w-full table-fixed border-collapse"
        style={{ border: `1px solid ${RULE}` }}
      >
        <tbody>
          <tr>
            <Label>NAMA</Label>
            <Value span={3}>{or(teacherName)}</Value>
          </tr>
          <tr>
            <Label>Subjek</Label>
            <Value>{or(subjectName ?? "")}</Value>
            <Label>Nama Kelas</Label>
            <Value>{or(planClassName ?? "")}</Value>
          </tr>
          <tr>
            <Label>Hari</Label>
            <Value>{hari}</Value>
            <Label>Tarikh</Label>
            <Value>{or(planDate ?? "")}</Value>
          </tr>
          <tr>
            <Label>Masa Mula</Label>
            <Value>{or(slotTime.slice(0, 5))}</Value>
            <Label>Masa Tamat</Label>
            <Value>{or(slotTimeEnd.slice(0, 5))}</Value>
          </tr>
          <tr>
            <Label>Tema / Bidang / Tajuk</Label>
            <Value span={3}>{or(temaLengkap(payload))}</Value>
          </tr>
          <tr>
            <Label>Standard Kandungan</Label>
            <Value span={3}>{or(payload.standard_kandungan)}</Value>
          </tr>
          <tr>
            <Label>Standard Pembelajaran</Label>
            <Value span={3}>{or(payload.standard_pembelajaran)}</Value>
          </tr>
          <tr>
            <Label>Objektif</Label>
            <Value span={3}>{or(payload.objektif)}</Value>
          </tr>
          <tr>
            <Label>Kriteria Kejayaan</Label>
            <Value span={3}>{or(payload.kriteria_kejayaan)}</Value>
          </tr>
          <tr>
            <Label>Aktiviti PdPC</Label>
            <Value span={3}>
              {payload.aktiviti.length === 0 ? (
                <span className="italic text-[#98a2b3]">— belum diisi —</span>
              ) : (
                payload.aktiviti.map((a, i) => (
                  <span
                    /* biome-ignore lint/suspicious/noArrayIndexKey: append-only,
                       never reordered, no per-item state — the rule guards against
                       state following an item across a reorder, which cannot
                       happen on a static printed list. */
                    key={`${a.nama}-${i}`}
                    className={cn("block", a.sub && "pl-5 before:mr-1 before:content-['-']")}
                  >
                    {or(a.nama)}
                  </span>
                ))
              )}
            </Value>
          </tr>
          <tr>
            <Label>Refleksi</Label>
            <Value span={3}>{or(payload.refleksi)}</Value>
          </tr>
        </tbody>
      </table>

      <SignatureSeal
        signature={signature ?? null}
        state={signatureState}
        variant="print"
        className="mt-3"
      />
    </article>
  );
}
