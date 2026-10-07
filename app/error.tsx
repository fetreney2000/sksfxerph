"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary (Next.js `error.tsx` contract).
 *
 * Backend §11 (observability): a render failure must surface to the user in
 * Malay with a recovery path — not a blank page. Errors are logged so an
 * error tracker can be attached later without changing this file.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[render]", error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[13px] bg-danger-soft text-xl text-danger-ink">
          !
        </div>
        <h1 className="mb-2 text-lg font-bold">Ralat semasa memuatkan halaman</h1>
        <p className="mb-1 text-[13px] text-ink-3">
          Kerja anda tidak hilang — RPH disimpan pada peranti ini.
        </p>
        {error.digest && (
          <p className="mb-4 font-mono text-[11px] text-ink-4">Rujukan: {error.digest}</p>
        )}
        <div className="flex justify-center gap-2.5">
          <Button onClick={reset}>Cuba lagi</Button>
          <Button variant="secondary" asChild>
            <Link href="/minggu">Ke Minggu Ini</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
