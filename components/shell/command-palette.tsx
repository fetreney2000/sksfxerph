"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { navFor } from "@/components/shell/nav";
import { useUser } from "@/components/shell/user-context";
import { createBlankRph } from "@/lib/actions/plans";
import { cn } from "@/lib/cn";
import { currentWeek } from "@/lib/config";
import { CLASSES } from "@/lib/demo/seed";

interface Cmd {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * ⌘K palette — the shortcut surface documented in the UI mockup.
 * Deliberately tiny: navigation + a handful of actions, no fuzzy-search library.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { role } = useUser();
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commands = React.useMemo<Cmd[]>(() => {
    const nav: Cmd[] = navFor(role).flatMap((g) =>
      g.items.map((i) => ({
        id: i.href,
        group: "Navigasi",
        label: i.label,
        run: () => router.push(i.href),
      })),
    );

    const actions: Cmd[] = [
      {
        id: "new",
        group: "Tindakan",
        label: "RPH baharu untuk kelas",
        hint: "N",
        // Creates the plan before navigating so the URL names the document —
        // falling back to /editor, which resolves an unfinished one, if the
        // store cannot produce a free slot.
        run: () => {
          void (async () => {
            const doc = await createBlankRph(currentWeek(), CLASSES);
            router.push(doc ? `/editor/${doc.id}` : "/editor");
          })();
        },
      },
      {
        id: "reuse",
        group: "Tindakan",
        label: "Guna semula RPH minggu lepas",
        run: () => router.push("/editor?reuse=1"),
      },
      {
        id: "theme",
        group: "Tindakan",
        label: "Tukar mod gelap / cerah",
        run: () => {
          const el = document.documentElement;
          const next = el.getAttribute("data-theme") === "dark" ? "light" : "dark";
          el.setAttribute("data-theme", next);
          localStorage.setItem("erph-theme", next);
        },
      },
    ];

    return [...nav, ...actions];
  }, [router, role]);

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(term) || c.group.toLowerCase().includes(term),
    );
  }, [commands, q]);

  React.useEffect(() => {
    if (!open) return;
    setQ("");
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[sel];
        if (cmd) {
          onClose();
          cmd.run();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, sel, onClose]);

  if (!open) return null;

  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-[rgba(10,16,28,0.55)] pt-[14vh] backdrop-blur-[3px] erph-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Arahan pantas"
    >
      {/* The backdrop is a real button so backdrop-dismissal is keyboard
          reachable, not just click-to-close on a non-focusable div. */}
      <button
        type="button"
        aria-label="Tutup"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="w-[min(560px,94vw)] overflow-hidden rounded-[15px] border border-border bg-surface shadow-lg erph-pop-in">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <Search className="h-4.5 w-4.5 text-ink-4" strokeWidth={2} aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            placeholder="Cari arahan, kelas atau Standard Kandungan…"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-ink-4"
          />
          <kbd className="rounded-md border border-border-strong bg-surface-3 px-1.5 py-px font-mono text-[10.5px] font-semibold text-ink-3">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-ink-4">Tiada hasil</p>
          )}
          {filtered.map((cmd, i) => {
            const header = cmd.group !== lastGroup ? cmd.group : null;
            lastGroup = cmd.group;
            return (
              <React.Fragment key={cmd.id}>
                {header && (
                  <p className="px-2.5 pt-2.5 pb-1.5 text-[10.5px] font-bold tracking-[0.8px] text-ink-4 uppercase">
                    {header}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    cmd.run();
                  }}
                  onMouseEnter={() => setSel(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[13.5px] font-medium text-ink-2 transition-colors",
                    i === sel && "bg-primary-soft text-primary-ink",
                  )}
                >
                  {cmd.label}
                  {cmd.hint && (
                    <kbd className="ml-auto rounded-md border border-border-strong bg-surface-3 px-1.5 py-px font-mono text-[10.5px] font-semibold text-ink-3">
                      {cmd.hint}
                    </kbd>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-border bg-surface-2 px-4 py-2.5 text-[11.5px] text-ink-4">
          <span>↑↓ navigasi</span>
          <span>↵ laksana</span>
          <span className="ml-auto">eRPH · mod pantas</span>
        </div>
      </div>
    </div>
  );
}
