"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  /** Deep-link target the school's own insert chose — 'dashboard', 'review'. */
  linkView?: string | null;
  readAt?: number | null;
  createdAt: number;
}

/**
 * One notification feed from two sources.
 *
 *  · Dexie — events generated *on this device* (e.g. an offline plan merged
 *    into a server plan), available offline.
 *  · `/api/notifications` — rows written by `sahkan_rph()` and `hantar_balik()`
 *    when a GPK decides on a plan, which the device has never seen.
 *
 * In local mode the API isn't called at all (no database), so the Dexie list
 * stands alone. Merged by id and sorted newest-first.
 *
 * Marking read goes to *both*. The Dexie write is what the offline list
 * reflects; the PATCH is what the school's rows need, because `read_at` on
 * `erph.notification` is not reachable from the client — and without it the
 * bell counted every review decision as unread for ever, with a button
 * beside it that could not clear them.
 */
export function useNotifications(): {
  items: FeedNotification[];
  markRead: (id: string) => void;
  markAllRead: () => void;
} {
  const queryClient = useQueryClient();

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
    void db.notifications.update(id, { readAt: Date.now() }).catch(() => undefined);
    sendRead({ ids: [id] });
  };

  const markAllRead = () => {
    const now = Date.now();
    void db.notifications
      .toCollection()
      .modify({ readAt: now })
      .catch(() => undefined);
    sendRead({ all: true });
  };

  /**
   * Tell the server, then refetch.
   *
   * The refetch matters as much as the write: `staleTime` is 30s and nothing
   * in the app invalidates this key, so without it the badge would keep
   * counting rows the caller has just marked read.
   */
  const sendRead = (body: { all?: boolean; ids?: string[] }) => {
    if (!supabaseConfigured) return;
    void fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    })
      .catch(() => undefined)
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      });
  };

  return { items, markRead, markAllRead };
}
