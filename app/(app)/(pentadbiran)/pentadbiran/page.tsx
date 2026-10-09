"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabaseConfigured } from "@/lib/config";
import { AccountsTab } from "./accounts-tab";
import { ClassesTab } from "./classes-tab";
import { SchoolTab } from "./school-tab";
import { SettingsTab } from "./settings-tab";
import { SubjectsTab } from "./subjects-tab";

/**
 * Pentadbiran — how the app is set up: who may use it, what they may teach
 * against, and the rules the whole school submits under.
 *
 * Administrator only, three times over: the layout redirects, the API refuses
 * (`requireAdministrator` → `erph.admin_set_*`), and the role itself sits
 * outside `is_staff` in SQL so nothing here can be reached by grading.
 *
 * Local mode has no backend and every write path returns 503, so the page says
 * so rather than rendering controls that cannot work — that sentence is also
 * what `tests/e2e/smoke.spec.ts` asserts, because "the Administrator reaches
 * it, and in local mode is told why it is empty" is the behaviour worth
 * pinning.
 *
 * Four tabs rather than two: the original covered accounts and deadlines, but
 * its own permission promises "accounts, classes, subjects, session, deadlines"
 * — and classes are not a nicety. They are what `rph_document.class_id` points
 * at, so a school that cannot manage them cannot plan against a class nobody
 * created.
 */

type Tab = "akaun" | "kelas" | "subjek" | "sekolah" | "tetapan";

const TABS: { value: Tab; label: string }[] = [
  { value: "akaun", label: "Akaun & peranan" },
  { value: "kelas", label: "Kelas" },
  { value: "subjek", label: "Mata pelajaran" },
  { value: "sekolah", label: "Maklumat sekolah" },
  { value: "tetapan", label: "Sesi & tarikh akhir" },
];

export default function PentadbiranPage() {
  const [tab, setTab] = React.useState<Tab>("akaun");

  if (!supabaseConfigured) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-[13.5px] font-semibold">
            Pentadbiran memerlukan mod disegerakkan.
          </p>
          <p className="mx-auto mt-1.5 max-w-[460px] text-[12.5px] text-ink-3">
            Mod setempat hanya mempunyai akaun demo dan tiada pangkalan data untuk disesuaikan.
            Apabila Supabase ditetapkan, halaman ini menguruskan akaun, peranan, kelas, mata
            pelajaran, sesi dan tarikh akhir.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">Urus eRPH</h2>
        <span className="h-px flex-1 bg-border" />
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
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
      </Tabs>
    </>
  );
}
