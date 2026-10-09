"use client";

import * as React from "react";
import { currentSchool, DEFAULT_SCHOOL, type SchoolBrand, subscribeSchool } from "@/lib/school";

/**
 * The school's identity, re-rendering the screen when the administrator
 * changes it.
 *
 * `useSyncExternalStore` rather than context because the value lives in a
 * module store shared with plain (non-React) code — `lib/rph-paper`'s default
 * school name and the export route both read it without a hook, and a context
 * would give them a second source of truth to drift from.
 *
 * The server snapshot is the default rather than the live value so the first
 * paint never reads a store that has not been populated yet.
 */
export function useSchool(): SchoolBrand {
  return React.useSyncExternalStore(subscribeSchool, currentSchool, () => DEFAULT_SCHOOL);
}
