import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { cn } from "@/lib/cn";
import type { SignatureState } from "@/lib/hooks/use-signature";

/**
 * The signature block a sealed plan carries.
 *
 * Three states, and the middle two matter more than the happy one:
 *
 *   valid   — the seal, naming the reviewer and the moment they sealed it.
 *   pending — still being checked. Shown rather than assumed valid, because a
 *             seal that appears before it has been verified is a claim, not
 *             evidence.
 *   invalid — **rendered loudly**. This is the state the design exists for: a
 *             signature that does not verify, or one whose envelope hash no
 *             longer matches the plan on screen. Hiding it, or degrading it to
 *             a quiet grey, would turn a tampered document into a trusted one.
 *
 * The component never decides validity — `useSignature` does — so the same
 * seal can be driven by a hook on screen and by data the export route already
 * knows about.
 */

/** `ms-MY` date + time, in the app's long form. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ms-MY", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

interface Props {
  signature: SignaturePayload | null;
  state: SignatureState;
  /**
   * `print` is for the A4 document: no background chrome, a rule above, and
   * sized for a signature block rather than a status card.
   */
  variant?: "screen" | "print";
  className?: string;
}

export function SignatureSeal({ signature, state, variant = "screen", className }: Props) {
  if (state === "none" || !signature) return null;

  if (state === "pending") {
    return (
      <p
        className={cn(
          "inline-flex items-center gap-2 text-[12.5px] text-ink-4",
          variant === "print" && "mt-4 text-[10px]",
          className,
        )}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden />
        Memeriksa tandatangan…
      </p>
    );
  }

  if (state === "invalid") {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-start gap-3 rounded-[10px] border border-danger-line bg-danger-soft p-3 text-[12.5px] leading-[1.55] text-danger-ink",
          variant === "print" && "mt-4 border-[#b42318] bg-[#fef3f2] p-2 text-[10px]",
          className,
        )}
      >
        <ShieldAlert
          className={cn("mt-0.5 h-4 w-4 shrink-0", variant === "print" && "h-3 w-3")}
          strokeWidth={2}
          aria-hidden
        />
        <span>
          <b>Tandatangan tidak sah.</b>{" "}
          {variant === "print"
            ? "Rancangan ini tidak boleh disahkan terhadap tandatangan yang tersimpan — kandungan mungkin telah berubah."
            : "Rancangan ini tidak boleh disahkan terhadap tandatangan yang tersimpan. Kandungan mungkin telah berubah selepas ia ditandatangani, atau tandatangan itu sendiri telah disentuh. Jangan keluarkan dokumen ini tanpa semakan lanjut."}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[12px] border border-success-line bg-success-soft p-3.5",
        variant === "print" && "mt-4 items-center gap-2.5 border-[#067647] bg-[#ecfdf3] p-2",
        className,
      )}
    >
      <ShieldCheck
        className={cn(
          "mt-0.5 h-5 w-5 shrink-0 text-success-ink",
          variant === "print" && "h-4 w-4",
        )}
        strokeWidth={2}
        aria-hidden
      />
      <div className="min-w-0">
        <p
          className={cn(
            "text-[11px] font-bold tracking-[0.9px] text-success-ink uppercase",
            variant === "print" && "text-[8px] tracking-[0.7px]",
          )}
        >
          Disahkan secara digital
        </p>
        <p
          className={cn(
            "mt-1 text-[14px] leading-tight font-bold text-ink",
            variant === "print" && "mt-0.5 text-[11px]",
          )}
        >
          {signature.signerName ?? "Penyemak"}
        </p>
        <p
          className={cn(
            "mt-1 text-[12px] text-ink-3",
            variant === "print" && "mt-0 text-[9px]",
          )}
        >
          {when(signature.signedAt)}
          <span className="mx-1.5 text-ink-4">·</span>
          <span className="font-mono text-[11px] text-ink-4">
            {signature.alg} · {signature.publicKey.slice(0, 10)}…
          </span>
        </p>
      </div>
    </div>
  );
}
