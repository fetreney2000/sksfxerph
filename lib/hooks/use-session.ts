"use client";

import * as React from "react";
import { currentSession, DEFAULT_SESSION, subscribeSession } from "@/lib/session";

/**
 * The school session in effect, re-rendering when the administrator changes it.
 *
 * `useSyncExternalStore` rather than context because the value lives in a module
 * store: `lib/actions/plans.ts` and `lib/db.ts` are plain functions that need the
 * same session without a hook, and a context would give them a second source of
 * truth to drift from.
 *
 * The server snapshot is the default rather than the live value so the first
 * paint never reads a store that has not been populated yet.
 */
export function useSession(): string {
  return React.useSyncExternalStore(subscribeSession, currentSession, () => DEFAULT_SESSION);
}
