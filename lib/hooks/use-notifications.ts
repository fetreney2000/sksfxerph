"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import * as React from "react";
import { handleExpiredSession } from "@/lib/client/auth-session";
import { supabaseConfigured } from "@/lib/config";
import { db } from "@/lib/db";

export interface FeedNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  readAt?: number | null;
  createdAt: number;
}

/**
 * One notification feed from two sources.
 *
 *  • Dexie — events generated *on this device* (e.g. an offline plan merged
 *    into a server plan), available offline.
 *  • `/api/notifications` — rows written by `review_rph()` and `pg_cron`,
 *    which the device has never seen.
 *
 * In local mode the API isn't called at all (no database), so the Dexie list
 * stands alone. Merged by id and sorted newest-first; duplicates can't occur
 * because the two id spaces don't overlap, but de-duping is cheap insurance
 * against a future bridge that copies rows down.
 */
export function useNotifications(): {
  items: FeedNotification[];
  markRead: (id: string) => void;
  markAllRead: () => void;
} {
  const local = useLiveQuery(
    async () =>
      (await db.notifications
        .orderBy("createdAt")
        .reverse()
        .limit(50)
        .toArray()) as FeedNotification[],
    [],
    [] as FeedNotification[],
  );

  const remote = useQuery<{ items: FeedNotification[] }>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications", { credentials: "same-origin" });
      if (handleExpiredSession(res.status)) return { items: [] };
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: FeedNotification[] };
    },
    enabled: supabaseConfigured,
    retry: false,
    staleTime: 30_000,
  });

  const items = React.useMemo(() => {
    const merged = [...(local ?? []), ...(remote.data?.items ?? [])];
    const seen = new Set<string>();
    return merged
      .filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20);
  }, [local, remote.data]);

  const markRead = (id: string) => {
    // Local rows live in Dexie; server rows are read-only from here (their
    // read_at belongs to erph.notification and would need its own route).
    void db.notifications.update(id, { readAt: Date.now() }).catch(() => undefined);
  };

  const markAllRead = () => {
    const now = Date.now();
    void db.notifications
      .toCollection()
      .modify({ readAt: now })
      .catch(() => undefined);
  };

  return { items, markRead, markAllRead };
}
