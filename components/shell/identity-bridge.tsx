"use client";

import * as React from "react";
import type { SchoolBrand } from "@/lib/school";
import { setSchool } from "@/lib/school";
import { setSession } from "@/lib/session";

/**
 * Adopts the server-resolved school identity and school year on the client.
 *
 * Rendered once by `(app)/layout.tsx`, which reads both per request. Two
 * reasons these are effects rather than render-time writes: both stores are
 * module state shared with plain (non-React) code, and writing during render
 * would fire subscribers before React has finished committing — which is how a
 * `useSyncExternalStore` consumer ends up in a render loop.
 *
 * Re-runs only when a value actually changes, so an ordinary navigation does
 * not re-broadcast either one.
 */
export function IdentityBridge({ session, school }: { session: string; school: SchoolBrand }) {
  React.useEffect(() => {
    setSession(session);
    setSchool(school);
  }, [session, school]);
  return null;
}
