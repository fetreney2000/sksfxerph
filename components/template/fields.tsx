"use client";

import { Input, Label, Select } from "@/components/ui/field";
import type { Curriculum } from "@/lib/types";

/**
 * What a template says about itself, apart from the plan inside it.
 *
 * The subject is deliberately *not* here: its value is the plan's, decided in
 * the penyunting's profil section, so a control bound to it here would be a
 * second opinion about the same value on one screen.
 */
export interface TemplateMeta {
  title: string;
  tahap: string;
  curriculum: Curriculum;
  visibility: "private" | "school";
}

export const EMPTY_TEMPLATE_META: TemplateMeta = {
  title: "",
  tahap: "",
  curriculum: "KSSR",
  visibility: "school",
};

export const CURRICULUMS: { value: Curriculum; label: string }[] = [
  { value: "KSSR", label: "KSSR (Sekolah Rendah)" },
  { value: "KSSM", label: "KSSM (Sekolah Menengah)" },
  { value: "PRASEKOLAH", label: "Prasekolah" },
];

/** Longest values `erph.rph_template` accepts — and the limits the API enforces. */
export const TITLE_MAX = 160;
export const TAHAP_MAX = 40;

export function TemplateMetaFields({
  idPrefix,
  meta,
  onChange,
}: {
  /** Every input in here lives on a screen that can render it twice. */
  idPrefix: string;
  meta: TemplateMeta;
  onChange: (patch: Partial<TemplateMeta>) => void;
}) {
  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}-title`} required>
          Tajuk
        </Label>
        <Input
          id={`${idPrefix}-title`}
          value={meta.title}
          maxLength={TITLE_MAX}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Matematik Tahun 5 · SK 3.1"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-tahap`}>Tahap</Label>
          <Input
            id={`${idPrefix}-tahap`}
            value={meta.tahap}
            maxLength={TAHAP_MAX}
            onChange={(e) => onChange({ tahap: e.target.value })}
            placeholder="Tahun 5"
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-curriculum`}>Kurikulum</Label>
          <Select
            id={`${idPrefix}-curriculum`}
            value={meta.curriculum}
            onChange={(e) => onChange({ curriculum: e.target.value as Curriculum })}
          >
            {CURRICULUMS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-visibility`}>Kongsi</Label>
          <Select
            id={`${idPrefix}-visibility`}
            value={meta.visibility}
            onChange={(e) => onChange({ visibility: e.target.value as "private" | "school" })}
          >
            <option value="school">Seluruh sekolah</option>
            <option value="private">Saya sahaja</option>
          </Select>
        </div>
      </div>
    </>
  );
}
