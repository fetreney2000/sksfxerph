"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { currentWeek, supabaseConfigured } from "@/lib/config";
import { seedLocalData } from "@/lib/demo/seed";
import { pullDocuments } from "@/lib/sync/pull";
import { flushQueue, isOnline } from "@/lib/sync/queue";

/**
 * App-wide client wiring. Four jobs, all idempotent:
 *
 *  1. React Query — server-state for the admin/read screens.
 *  2. Seed local demo data once, only if the store is empty (local mode).
 *  3. Flush the sync queue when connectivity returns or on a slow interval.
 *  4. Register the service worker (production only — never cache dev builds).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  React.useEffect(() => {
    // Local mode only. The fixtures carry class ids like `c-5a`, which are not
    // UUIDs — `sync_rph` casts `class_id`, so writing them into a synced
    // deployment would leave a dashboard full of demo plans that can never
    // reach the server, each one failing on every flush. The comment on this
    // function has always said "(local mode)"; the call is what forgot.
    if (!supabaseConfigured) void seedLocalData(currentWeek());

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err: unknown) => {
        // Never break the app over a caching layer — but do make the failure
        // visible, otherwise a broken SW is indistinguishable from a slow one.
        console.error("[sw] registration failed", err);
      });
    }

    const refresh = () => {
      // Push before pull. Pulling while a local edit is still queued would be
      // pointless — `pullDocuments` skips exactly those rows anyway — and this
      // order means a plan written on another device arrives already flushed
      // over anything this one has changed since.
      void flushQueue().then(() => pullDocuments());
    };

    const onOnline = refresh;
    const onOffline = () => undefined;
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // First paint of a new session: get whatever happened elsewhere while this
    // browser was closed. The 30s interval below is a *retry* for failed
    // pushes, so it does not also pull — polling on every tick would be a
    // request for data that changes once a week.
    void refresh();

    // Safety net: some Android webviews don't fire `online` reliably.
    const t = setInterval(() => {
      if (isOnline()) void flushQueue();
    }, 30_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(t);
    };
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
