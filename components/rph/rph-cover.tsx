import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { Label, RULE, Value } from "@/components/rph/rph-paper";
import { SignatureSeal } from "@/components/rph/signature-seal";
import { cn } from "@/lib/cn";
import type { SignatureState } from "@/lib/hooks/use-signature";
import { ms } from "@/lib/i18n/ms";
import { currentSchool } from "@/lib/school";
import type { RphStatus } from "@/lib/types";

/**
 * Page 1 of a week's submission — "SEMAKAN RANCANGAN HARIAN GURU".
 *
 * This is a different shape from the pages behind it, and that is the whole
 * reason it is a separate component. The daily RPH is one lesson on one day,
 * written by a teacher. The cover is one *week* of them: submitted once, on
 * one date, carrying one pentadbir's signature, jawatan and the date they
 * confirmed it. Those fields cannot be repeated onto every daily page without
 * the sheet lying — six pages cannot have been submitted at six different
 * times, and cannot each hold the week's single approval.
 *
 * Printed ahead of the week it covers, so the district receiving a stapled
 * stack reads the summary before the detail.
 */
const STATUS_LABEL: Record<RphStatus, string> = {
  draft: ms.status.draft,
  submitted: ms.status.submitted,
  forwarded: ms.status.forwarded,
  approved: ms.status.approved,
  returned: ms.status.returned,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "19-01-2026 | 09:06 AM" — the form's own stamp, down to the minute. */
function submissionStamp(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} | ${pad(h12)}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** "21-01-2026" — the date alone, for TARIKH PENGESAHAN. */
function dayStamp(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

const or = (s: string | null | undefined) => (s?.trim() ? s.trim() : "—");

interface Props {
  weekNo: number;
  session: string;
  teacherName?: string;
  /** Epoch ms or ISO — the form prints the minute, so both are accepted. */
  submittedAt?: number | string | null;
  status: RphStatus;
  /** Verified material, or null while the week is unsigned. */
  signature?: SignaturePayload | null;
  signatureState?: SignatureState;
  /** CATATAN PENTADBIR. Blank when the reviewer left none — as on the paper. */
  comment?: string | null;
  schoolName?: string;
  className?: string;
}

export function RphCover({
  weekNo,
  session,
  teacherName,
  submittedAt,
  status,
  signature,
  signatureState = "none",
  comment,
  schoolName = currentSchool().name,
  className,
}: Props) {
  const sealed = signatureState === "valid" ? (signature ?? null) : null;
  // "M1 / 2026" — the week and the calendar year it belongs to, which is what
  // gets written on the paper form by hand.
  const weekLabel = `M${weekNo} / ${(session.split("/")[0] ?? session).trim()}`;

  return (
    <article
      className={cn(
        "erph-sheet rounded-lg bg-white p-6 text-[12.5px] leading-[1.5] text-[#1d2939] shadow-lg",
        className,
      )}
    >
      <h2 className="text-center text-[17px] font-normal tracking-[0.3px]">
        SEMAKAN RANCANGAN HARIAN GURU
      </h2>
      <p className="mt-1 mb-4 text-center text-[10px] tracking-[0.4px] text-[#b0b7c3]">
        {schoolName} · {session}
      </p>

      <table
        className="w-full table-fixed border-collapse"
        style={{ border: `1px solid ${RULE}` }}
      >
        <tbody>
          <tr>
            <Label>MINGGU</Label>
            <Value span={3}>{weekLabel}</Value>
          </tr>
          <tr>
            <Label>NAMA GURU</Label>
            <Value span={3}>{or(teacherName)}</Value>
          </tr>
          <tr>
            <Label>TARIKH PENGHANTARAN</Label>
            <Value span={3}>{submissionStamp(submittedAt)}</Value>
          </tr>
          <tr>
            <Label>STATUS</Label>
            <Value span={3}>{STATUS_LABEL[status]}</Value>
          </tr>
          <tr>
            <Label>TANDATANGAN PENTADBIR</Label>
            <Value span={3}>
              {/* Not a placeholder: `SignatureSeal` prints a blank reviewer
                  line when nothing is sealed, which is what the paper form has
                  the week before a GPK gets to it. */}
              <SignatureSeal
                signature={sealed}
                state={signatureState}
                variant="print"
                className="mt-0"
              />
            </Value>
          </tr>
          <tr>
            <Label>NAMA PENTADBIR</Label>
            <Value span={3}>{sealed ? or(sealed.signerName) : "—"}</Value>
          </tr>
          <tr>
            <Label>JAWATAN</Label>
            <Value span={3}>{sealed ? or(sealed.signerTitle) : "—"}</Value>
          </tr>
          <tr>
            <Label>CATATAN PENTADBIR</Label>
            <Value span={3}>
              {/* A box, not a dash: on the paper form this is where the
                  reviewer writes, and an empty one still has to look like
                  somewhere to write. */}
              <div className="min-h-16 whitespace-pre-wrap">{comment ?? ""}</div>
            </Value>
          </tr>
          <tr>
            <Label>TARIKH PENGESAHAN</Label>
            <Value span={3}>{sealed ? dayStamp(sealed.signedAt) : "—"}</Value>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
