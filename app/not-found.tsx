import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md text-center">
        <p className="mb-2 text-4xl font-extrabold tracking-tight text-ink-4">404</p>
        <h1 className="mb-2 text-lg font-bold">Halaman tidak dijumpai</h1>
        <p className="mb-5 text-[13px] text-ink-3">
          Pautan mungkin lama atau RPH telah dipindahkan.
        </p>
        <Button asChild>
          <Link href="/minggu">Ke Minggu Ini</Link>
        </Button>
      </div>
    </main>
  );
}
