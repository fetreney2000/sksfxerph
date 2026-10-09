"use client";

import { useQuery } from "@tanstack/react-query";
import { schoolCode, supabaseConfigured } from "@/lib/config";
import { CLASSES, SUBJECTS } from "@/lib/demo/seed";
import type { SchoolClass, Subject } from "@/lib/types";

/**
 * The school's classes and subjects — what the editor's two pickers offer.
 *
 * Local mode returns the bundled fixtures and never issues a request; synced
 * mode reads `/api/classes` and `/api/subjects`, which scope the rows to the
 * caller's own school.
 *
 * This split exists because the fixtures are not safe in synced mode. Their ids
 * (`c-5a`) are not UUIDs, `rph_document.class_id` is a UUID column, and
 * `sync_rph` casts it — so a plan built against a fixture was rejected on every
 * flush with "kelas bukan dalam sekolah/sesi anda", which reads on screen as a
 * sync that never finishes. Serving the real classes is the fix, and it is also
 * what makes the administrator's class list mean anything: a class added on
 * `/pentadbiran` appears here without a redeploy.
 *
 * While a synced fetch is still in flight the list is empty rather than
 * fixture-backed. Every caller already treats an empty list as "nothing to do"
 * (`createBlankRph` returns `undefined` and the buttons toast), which is the
 * honest answer during load — offering demo classes for one render is how the
 * bad id got into the database in the first place.
 */
export interface SchoolData<T> {
  items: T[];
  loading: boolean;
}

export function useSchoolClasses(): SchoolData<SchoolClass> {
  const query = useQuery<{ items: SchoolClass[] }>({
    queryKey: ["school-classes", schoolCode],
    queryFn: async () => {
      const res = await fetch("/api/classes", { credentials: "same-origin" });
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: SchoolClass[] };
    },
    enabled: supabaseConfigured,
    retry: false,
    staleTime: 60_000,
  });

  if (!supabaseConfigured) return { items: CLASSES, loading: false };
  return { items: query.data?.items ?? [], loading: query.isLoading };
}

export function useSchoolSubjects(): SchoolData<Subject> {
  const query = useQuery<{ items: Subject[] }>({
    queryKey: ["school-subjects", schoolCode],
    queryFn: async () => {
      const res = await fetch("/api/subjects", { credentials: "same-origin" });
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: Subject[] };
    },
    enabled: supabaseConfigured,
    retry: false,
    staleTime: 60_000,
  });

  if (!supabaseConfigured) return { items: SUBJECTS, loading: false };
  return { items: query.data?.items ?? [], loading: query.isLoading };
}
