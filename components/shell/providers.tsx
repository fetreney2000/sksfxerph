"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { getCalendar } from "@/lib/client/admin";
import { currentWeek, setCalendarAnchors, supabaseConfigured } from "@/lib/config";
import { seedLocalData } from "@/lib/demo/seed";
import { useSession } from "@/lib/hooks/use-session";

/**
 * App-wide client wiring. Two jobs, both idempotent:
 *
 *  1. React Query - server state for every screen. Reads go straight to the
 *     API; writes are explicit POST/PATCH/DELETE calls, so there is no local
 *     queue to flush and nothing to re-fetch on reconnect.
 *  2. Seed local demo data once, only in the offline dev harness (no backend
 *     configured) where the demo seed lives.
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

  // Which session the app is writing into, and therefore whose calendar it must
  // read. Subscribed rather than read once for the same reason as every other
  // week in the app: the administrator can change it underneath us.
  const session = useSession();

  React.useEffect(() => {
    // Development harness only: the demo seed lives in IndexedDB and there
    // is no backend to read from. Production always has Supabase configured,
    // so this never runs there - and there is nothing else to do on mount:
    // every screen reads the server through React Query.
    if (!supabaseConfigured) void seedLocalData(currentWeek());
  }, []);

  /**
   * The school's declared weeks.
   *
   * Its own effect rather than a line in the one above, because it depends on
   * the session: the answer is per-session, so after a year rollover the previous
   * session's anchors would keep renumbering the new one's weeks until somebody
   * happened to reload.
   *
   * It also re-asks whenever the tab is looked at again. Nothing else does -
   * React Query's focus refetch is off app-wide - so a dashboard left open
   * through somebody else's declaration would show the old week for as long as
   * it stayed open, which is the one thing this feature exists to keep every
   * screen agreeing on.
   *
   * Local mode runs the same effect with no request: `setCalendarAnchors([])`
   * still has to happen, because the penyunting waits on this signal before it
   * stamps a week and with no server to ask, waiting forever is not an option.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `session` is the trigger, not a value the body reads. `/api/calendar` answers for the *current* session, so a rollover has to re-ask - and nothing inside the effect can name the session to make that look necessary.
  React.useEffect(() => {
    if (!supabaseConfigured) {
      setCalendarAnchors([]);
      return;
    }

    let live = true;
    const load = () => {
      void getCalendar()
        .then((anchors) => {
          if (live) setCalendarAnchors(anchors);
        })
        .catch((err: unknown) => {
          // Logged, and still marked answered. A school that did declare weeks
          // would number from the term start instead - wrong, but working -
          // where leaving it unanswered would leave every new plan unable to
          // decide its week at all.
          console.error("[calendar] load failed:", err);
          if (live) setCalendarAnchors([]);
        });
    };

    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
