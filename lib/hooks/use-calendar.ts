"use client";

import { useSyncExternalStore } from "react";
import {
  currentWeek,
  getCalendarAnchors,
  isCalendarLoaded,
  subscribeCalendarAnchors,
} from "@/lib/config";

/**
 * "What week is it?" as a component that re-renders when the answer changes.
 *
 * `currentWeek()` is a free function you can call from anywhere, but React only
 * re-renders a component when *its own* state changes — so a screen that
 * computed `const WEEK = currentWeek()` would keep showing the automatic
 * numbering after the school's declaration arrived from the server. Calling
 * this instead subscribes to the calendar store, and the value comes from the
 * same `currentWeek()` everything else uses.
 *
 * It is also why the four `const WEEK = currentWeek()` that sat at module scope
 * had to move inside their components: a module constant is evaluated when the
 * bundle loads, which is before any request has been made, and no hook can
 * change a value that is already fixed.
 *
 * Empty on first paint and empty forever in local mode — both correct, and both
 * mean exactly what the term-start grid has always meant.
 */
export function useCurrentWeek(): number {
  useSyncExternalStore(subscribeCalendarAnchors, getCalendarAnchors, getCalendarAnchors);
  return currentWeek();
}

/**
 * Whether the calendar has been answered for yet.
 *
 * For code that has to *choose* an answer rather than display one — the
 * penyunting stamps a new plan with its week, and a week chosen before the
 * school's declarations arrived would be wrong in a way nothing later corrects.
 * It gates an effect rather than the render, so there is no loading flash: the
 * page paints as it always did and the effect simply runs once more later.
 *
 * False on the server and false on first paint, which is honest in both cases —
 * neither has asked the question yet.
 */
export function useCalendarReady(): boolean {
  return useSyncExternalStore(subscribeCalendarAnchors, isCalendarLoaded, isCalendarLoaded);
}
