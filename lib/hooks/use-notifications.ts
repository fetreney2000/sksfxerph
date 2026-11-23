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
  /** Deep-link target the school's own insert chose - 'dashboard', 'review'. */
  linkView?: string | null;
  readAt?: number | null;
  createdAt: number;
}

/**
 * One notification feed.
 *
 * Synced mode reads the server only: `/api/notifications` rows written by
 * `sahkan_rph()` and `hantar_balik()` when a reviewer decides. The old Dexie
 * mirror existed for offline-generated events (merges, rejected syncs) - with
 * no offline queue there is nothing to mirror.
 *
 * Local mode (the development harness) has no server, so the Dexie list
 * stands alone there. Merged by id and sorted newest first.
 */
export function useNotifications(): {
  items: FeedNotification[];
  markRead: (id: string) => void;
  markAllRead: () => void;
} {
  const queryClient = useQueryClient();

  const local = useLiveQuery(
    async () => {
      // Harness only: production never writes here, so there is nothing to
      // read back there either. Skipping the IndexedDB read entirely keeps
      // the production path free of the local store.
      if (supabaseConfigured) return [] as FeedNotification[];
      return (await db.notifications
        .orderBy("createdAt")
        .reverse()
        .limit(50)
        .toArray()) as FeedNotification[];
    },
    // Re-run when the deployment flips modes mid-session (dev harness).
    [supabaseConfigured],
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
    // Decisions are written by another session; a teacher watching the page
    // should not have to reload to see one. Fifteen seconds keeps feedback
    // timely without turning the feed into a busy loop.
    refetchInterval: supabaseConfigured ? 15_000 : false,
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
    // The harness list is the only list there; the server is the only list
    // everywhere else.
    if (!supabaseConfigured) {
      void db.notifications.update(id, { readAt: Date.now() }).catch(() => undefined);
      return;
    }
    sendRead({ ids: [id] });
  };

  const markAllRead = () => {
    if (!supabaseConfigured) {
      const now = Date.now();
      void db.notifications
        .toCollection()
        .modify({ readAt: now })
        .catch(() => undefined);
      return;
    }
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
