"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ms } from "@/lib/i18n/ms";
import { pendingCount } from "@/lib/sync/queue";

type SyncState = "synced" | "offline" | "saving";

/**
 * The single most important status indicator in the product.
 *
 * Teachers are told explicitly what happened to their work:
 *   • Disegerakkan          — server has it
 *   • Luar talian · n belum disegerakkan — saved on device, queued
 *   • Menyimpan…            — write in flight
 *
 * It never reports "error" at the user: an unreachable server is an *offline*
 * state from a teacher's point of view, and the retry is automatic.
 */
export function SyncChip() {
  const [state, setState] = useState<SyncState>("synced");
  const [depth, setDepth] = useState(0);

  useEffect(() => {
    const refresh = async () => setDepth(await pendingCount());
    refresh();

    const onOffline = () => setState("offline");
    const onOnline = () => {
      setState("saving");
      // flushQueue is fire-and-forget; the queue listener in providers.tsx
      // flips us back to 'synced' when the depth reaches zero.
      import("@/lib/sync/queue").then((m) => void m.flushQueue());
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (navigator.onLine === false) setState("offline");

    const t = setInterval(refresh, 4000);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (depth === 0 && state !== "offline") {
      setState((s) => (s === "saving" ? "synced" : s));
    } else if (depth > 0 && navigator.onLine) {
      setState((s) => (s === "synced" ? "saving" : s));
    }
  }, [depth, state]);

  const offline = state === "offline" || depth > 0;
  const label = offline
    ? depth > 0
      ? ms.status.queued(depth)
      : ms.status.offline
    : state === "saving"
      ? ms.status.saving
      : ms.status.synced;

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold",
        offline
          ? "border-warning-line bg-warning-soft text-warning-ink"
          : "border-border bg-surface text-ink-2",
      )}
    >
      <span
        className={cn(
          "h-1.75 w-1.75 rounded-full",
          offline ? "bg-warning erph-pulse" : "bg-success",
        )}
        aria-hidden
      />
      {offline ? (
        <CloudOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      ) : state === "saving" ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden />
      ) : null}
      {label}
    </span>
  );
}
