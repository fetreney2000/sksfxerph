"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { currentWeek } from "@/lib/config";
import { seedLocalData } from "@/lib/demo/seed";
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
    void seedLocalData(currentWeek());

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err: unknown) => {
        // Never break the app over a caching layer — but do make the failure
        // visible, otherwise a broken SW is indistinguishable from a slow one.
        console.error("[sw] registration failed", err);
      });
    }

    const onOnline = () => void flushQueue();
    const onOffline = () => undefined;
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

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
