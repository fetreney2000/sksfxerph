"use client";

import * as React from "react";
import { homeFor } from "@/lib/auth/permissions";
import { googleAuthConfigured, googleClientId, googleDomain } from "@/lib/config";

/**
 * Sign in with a KPM Google account.
 *
 * Uses the Google Identity Services **JavaScript API** rather than their HTML
 * button-plus-redirect, because the redirect posts a full page to a login URI
 * and reloads — while this app already knows exactly where a successful sign-in
 * goes. The credential is sent by `XMLHttpRequest` with a custom header, which
 * is the CSRF pattern Google recommends for that route: a cross-origin caller
 * would have to preflight, and this server grants no preflight.
 *
 * ── `auto_select` is off on purpose ──────────────────────────────────────────
 * Staff-room laptops are shared. One Tap's whole value is remembering who used
 * the machine last, which is exactly the wrong behaviour for a system where a
 * GPK's scope decides whose plans they can see — "it thought I was the previous
 * teacher" is a failure this app cannot afford. The user always picks.
 *
 * Renders nothing at all when Google is not configured, which is both the
 * local-mode story and the state a deployment is in before someone sets the
 * client id.
 */

interface GoogleAccountsId {
  initialize: (options: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    auto_select?: boolean;
    prompt?: string;
  }) => void;
  renderButton: (
    element: HTMLElement,
    options: { theme?: string; size?: string; text?: string; width?: number },
  ) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

/** Load the GIS library once per page, however many components ask. */
let gisReady: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisReady) return gisReady;

  gisReady = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-gis]");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gis load failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.gis = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gis load failed"));
    document.head.appendChild(script);
  });

  return gisReady;
}

export function GoogleSignIn({ onError }: { onError: (message: string) => void }) {
  const host = React.useRef<HTMLDivElement>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!googleAuthConfigured) return;

    let cancelled = false;

    loadGis()
      .then(() => {
        if (cancelled || !host.current || !window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
          client_id: googleClientId,
          // Always ask who is signing in — see the note above about shared
          // machines and One Tap.
          auto_select: false,
          prompt: "select_account",
          callback: ({ credential }) => {
            if (!credential) return;
            void (async () => {
              try {
                const res = await fetch("/api/auth/google", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    // The CSRF proof: cross-origin requests may not set a
                    // custom header without a preflight, which never succeeds.
                    "x-requested-with": "XMLHttpRequest",
                  },
                  credentials: "same-origin",
                  body: JSON.stringify({ credential }),
                });

                const body = (await res.json().catch(() => null)) as {
                  error?: string;
                  role?: string;
                } | null;

                if (!res.ok) {
                  onError(body?.error ?? "Log masuk Google gagal. Cuba lagi.");
                  return;
                }
                // Full navigation: the (app) layout reads the cookie
                // server-side, so the shell has to be rendered by the server.
                // `homeFor` rather than a local copy — the login card already
                // uses it, and two implementations of "where does this role
                // land" is how a role ends up bouncing between two screens.
                window.location.assign(homeFor(body?.role));
              } catch {
                onError("Rangkaian bermasalah. Cuba log masuk dengan kata laluan.");
              }
            })();
          },
        });

        window.google.accounts.id.renderButton(host.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          width: 320,
        });
        setReady(true);
      })
      .catch(() => {
        // Google unreachable — which in a school means the network, not the
        // app. Password login is still there, so this is a note, not a fault.
        onError("Log masuk Google tidak tersedia. Gunakan kata laluan.");
      });

    return () => {
      cancelled = true;
    };
  }, [onError]);

  if (!googleAuthConfigured) return null;

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11.5px] font-semibold tracking-[0.6px] text-ink-4 uppercase">
          atau
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div ref={host} className="flex justify-center" />

      {!ready && (
        <p className="mt-1 text-center text-[12px] text-ink-4">Menyiapkan log masuk Google…</p>
      )}

      <p className="mt-3 text-center text-[11.5px] leading-[1.5] text-ink-4">
        Guru: gunakan akaun <span className="font-semibold">@{googleDomain}</span> (DELIMa)
        anda. Kata laluan kekal tersedia sebagai pilihan.
      </p>
    </div>
  );
}
