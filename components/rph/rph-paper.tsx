import type * as React from "react";
import { cn } from "@/lib/cn";
import type { RphPayload } from "@/lib/schemas/rph";
import { currentSchool } from "@/lib/school";

/**
 * The A4-shaped KPM RPH document.
 *
 * Rendered from the same JSON as the editor form — one source of truth, so what
 * a teacher sees on screen is byte-identical to what prints and what the
 * reviewer grades. This is what has to survive inspection under Peraturan 8,
 * Akta Pendidikan 1996.
 */
export function RphPaper({
  payload,
  className,
  teacherName = "Nurul Aisyah binti Rahim",
  schoolName = currentSchool().name,
  session,
}: {
  payload: RphPayload;
  className?: string;
  teacherName?: string;
  schoolName?: string;
  session: string;
}) {
  return (
    <article
      className={cn(
        "relative rounded-lg border border-[#e4e7ec] bg-white p-6 text-[12.5px] text-[#1d2939] shadow-lg",
        "before:absolute before:top-0 before:right-0 before:left-0 before:h-1 before:bg-gradient-to-r before:from-[#175cd3] before:to-[#53b1fd]",
        className,
      )}
    >
      <h4 className="text-center text-[13.5px] font-bold tracking-[0.5px] uppercase">
        Rancangan Pengajaran Harian
      </h4>
      <p className="mb-4 text-center text-[11.5px] text-[#667085]">
        {schoolName} · {session} · Guru: {teacherName}
      </p>

      <Meta payload={payload} />

      <Section title="Objektif Pembelajaran" done={payload.objektif.trim() !== ""}>
        {payload.objektif || "—"}
      </Section>

      <Section
        title="Aktiviti Pengajaran & Pembelajaran"
        done={payload.aktiviti.length > 0}
        hint={payload.aktiviti.length > 0 ? `${payload.aktiviti.length} aktiviti` : undefined}
      >
        {payload.aktiviti.length > 0 ? (
          <ActivityTable payload={payload} />
        ) : (
          <span className="text-[#98a2b3] italic">— belum diisi —</span>
        )}
      </Section>

      <Section title="EMK / Nilai" done={payload.emk.length > 0 || payload.kbat.trim() !== ""}>
        {payload.emk.length > 0 ? payload.emk.join(" · ") : "—"}
        {payload.kbat.trim() !== "" && (
          <p className="mt-1 text-[#475467]">KBAT: {payload.kbat}</p>
        )}
      </Section>

      <Section
        title="Refleksi & Intervensi"
        done={payload.refleksi.trim() !== "" && payload.intervensi.trim() !== ""}
      >
        {payload.refleksi.trim() !== "" ? (
          <>
            <p>{payload.refleksi}</p>
            {payload.intervensi.trim() !== "" && (
              <p className="mt-1.5 text-[#475467]">
                <strong>Intervensi:</strong> {payload.intervensi}
              </p>
            )}
          </>
        ) : (
          <span className="text-[#98a2b3] italic">— belum diisi —</span>
        )}
      </Section>

      <div className="mt-4 flex gap-6">
        <span className="flex-1 border-t-[1.5px] border-dashed border-[#d7dce5] pt-1.5 text-center text-[11px] text-[#98a2b3]">
          Tandatangan Guru
        </span>
        <span className="flex-1 border-t-[1.5px] border-dashed border-[#d7dce5] pt-1.5 text-center text-[11px] text-[#98a2b3]">
          Semakan Pentadbir
        </span>
      </div>
    </article>
  );
}

function Meta({ payload }: { payload: RphPayload }) {
  const cell = "border border-[#d7dce5] px-2 py-1.5";
  const head = cn(cell, "bg-[#f7f9fc] text-left text-[12px] font-semibold text-[#344054]");

  return (
    <table className="mb-3 w-full border-collapse">
      <tbody>
        <tr>
          <th className={cn(head, "w-[148px]")} scope="row">
            Standard Kandungan
          </th>
          <td className={cell} colSpan={3}>
            {payload.standard_kandungan || (
              <span className="text-[#98a2b3] italic">— belum dipilih —</span>
            )}
          </td>
        </tr>
        <tr>
          <th className={head} scope="row">
            Standard Pembelajaran
          </th>
          <td className={cell} colSpan={3}>
            {payload.standard_pembelajaran || (
              <span className="text-[#98a2b3] italic">— belum dipilih —</span>
            )}
          </td>
        </tr>
        <tr>
          <th className={head} scope="row">
            Fasa / Tema
          </th>
          <td className={cell}>{payload.fasa_tema || "—"}</td>
          <th className={cn(head, "w-[148px]")} scope="row">
            Bilangan Murid
          </th>
          <td className={cn(cell, "num")}>{payload.bilangan_murid ?? "—"}</td>
        </tr>
      </tbody>
    </table>
  );
}

function ActivityTable({ payload }: { payload: RphPayload }) {
  const cell = "border border-[#d7dce5] px-2 py-1.5";
  const head = cn(cell, "bg-[#fbfcfe] text-left text-[11.5px] font-semibold text-[#344054]");
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={cn(head, "w-[58px]")} scope="col">
            Masa
          </th>
          <th className={head} scope="col">
            Guru
          </th>
          <th className={head} scope="col">
            Murid
          </th>
        </tr>
      </thead>
      <tbody>
        {payload.aktiviti.map((a, i) => (
          <tr key={`${a.masa}-${i}`}>
            <td className={cn(cell, "num")}>{a.masa}</td>
            <td className={cell}>{a.aktiviti_guru}</td>
            <td className={cell}>{a.aktiviti_murid}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({
  title,
  done,
  hint,
  children,
}: {
  title: string;
  done: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 overflow-hidden rounded-[3px] border border-[#d7dce5]">
      <div className="flex items-center justify-between border-b border-[#d7dce5] bg-[#f7f9fc] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#344054]">
        <span>{title}</span>
        <span
          className={cn(
            "text-[10px] font-semibold",
            done ? "text-[#067647]" : "text-[#98a2b3]",
          )}
        >
          {hint ?? (done ? "✓ lengkap" : "belum diisi")}
        </span>
      </div>
      <div className="px-2.5 py-2 leading-[1.55]">{children}</div>
    </div>
  );
}
