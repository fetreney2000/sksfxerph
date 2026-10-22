"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountsTab } from "./accounts-tab";
import { CalendarTab } from "./calendar-tab";
import { ClassesTab } from "./classes-tab";
import { SchoolTab } from "./school-tab";
import { SettingsTab } from "./settings-tab";
import { SubjectsTab } from "./subjects-tab";

/**
 * The set-up console: who may use the app, what they teach against, and the
 * rules the whole school submits under.
 *
 * It used to own `/pentadbiran`, separate from `/utama`. Two screens that both
 * called themselves the administrator's home made the admin choose between
 * "see the school" and "set up the school"; this component now sits inside the
 * one Papan Pemuka. It stays a component rather than page-local markup so the
 * console can be rendered and tested without the route's local-mode gate.
 *
 * Four tabs rather than two: the original covered accounts and deadlines, but
 * its own permission promises "accounts, classes, subjects, session, deadlines"
 * — and classes are not a nicety. They are what `rph_document.class_id` points
 * at, so a school that cannot manage them cannot plan against a class nobody
 * created.
 *
 * Kalendar minggu is the newest, and the smallest job: the app counts weeks from
 * a fixed term start, and a school whose calendar says otherwise needs one place
 * to say which date range is week 34. It sits beside the session for the same
 * reason session does — both are the calendar the whole school's numbers come
 * from.
 */

export type AdminTab = "akaun" | "kelas" | "subjek" | "sekolah" | "tetapan" | "kalendar";

export const ADMIN_TABS: { value: AdminTab; label: string }[] = [
  { value: "akaun", label: "Akaun dan peranan" },
  { value: "kelas", label: "Kelas" },
  { value: "subjek", label: "Mata pelajaran" },
  { value: "sekolah", label: "Maklumat sekolah" },
  { value: "tetapan", label: "Sesi dan tarikh akhir" },
  { value: "kalendar", label: "Kalendar minggu" },
];

export function AdminConsole({
  tab: controlledTab,
  onTabChange,
}: {
  /** Controlled by Papan Pemuka so the checklist can open a specific tab. */
  tab?: AdminTab;
  onTabChange?: (tab: AdminTab) => void;
}) {
  const [internalTab, setInternalTab] = React.useState<AdminTab>("akaun");
  const tab = controlledTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as AdminTab)}>
      <section id="urus-erph" className="scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Urus eRPH</h2>
          <span className="h-px flex-1 bg-border" />
          <TabsList>
            {ADMIN_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="akaun">
          <AccountsTab />
        </TabsContent>
        <TabsContent value="kelas">
          <ClassesTab />
        </TabsContent>
        <TabsContent value="subjek">
          <SubjectsTab />
        </TabsContent>
        <TabsContent value="sekolah">
          <SchoolTab />
        </TabsContent>
        <TabsContent value="tetapan">
          <SettingsTab />
        </TabsContent>
        <TabsContent value="kalendar">
          <CalendarTab />
        </TabsContent>
      </section>
    </Tabs>
  );
}
