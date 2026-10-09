"use client";

import * as React from "react";
import { setSession } from "@/lib/session";

/**
 * Adopts the server-resolved school session on the client.
 *
 * Rendered once by `(app)/layout.tsx`, which reads `school_setting.current_session`
 * per request. Two reasons this is an effect and not a render-time write: the
 * store is module state shared with plain (non-React) code, and writing to it
 * during render would fire subscribers before React has finished committing —
 * which is how a `useSyncExternalStore` consumer ends up in a render loop.
 *
 * Re-runs only when the value actually changes, so navigating between screens
 * does not re-broadcast an unchanged session.
 */
export function SessionBridge({ session }: { session: string }) {
  React.useEffect(() => {
    setSession(session);
  }, [session]);
  return null;
}
