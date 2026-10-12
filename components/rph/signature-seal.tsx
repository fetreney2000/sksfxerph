import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { cn } from "@/lib/cn";
import { formatMyt } from "@/lib/date";
import type { SignatureState } from "@/lib/hooks/use-signature";
import { fingerprint } from "@/lib/signature";

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

/** `ms-MY` date + time, in the school's own zone. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatMyt({
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
  // On paper this is where the reviewer signs, so the block is drawn even when
  // nothing has been sealed: a rule and two blank lines, which is what the
  // form has before anyone has approved it. On screen there is nothing to
  // show — a blank block in a status column would read as an approval that
  // has not happened.
  if (state === "none" || !signature) {
    return variant === "print" ? (
      <div className={cn("mt-4 flex flex-col items-end text-right", className)}>
        <div className="w-full max-w-64 border-t border-[#1d2939]" />
        <p className="mt-1 h-3.5 w-full max-w-64 text-[10.5px] leading-tight text-[#1d2939]">
          &nbsp;
        </p>
        <p className="h-3 w-full max-w-64 text-[10px] leading-tight text-[#667085]">&nbsp;</p>
      </div>
    ) : null;
  }

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

  const name = signature.signerName ?? "Penyemak";
  const key = fingerprint(signature.publicKey);

  // On paper this is a signature block, not a status card: a rule to rest a
  // pen on, the name under it, the office under that, the moment — and the
  // verification kept to one quiet line. A green rounded panel printed on
  // every approved sheet is a screenshot of the app, and the district files
  // forms, not screenshots.
  if (variant === "print") {
    return (
      <div className={cn("mt-4 flex flex-col items-end text-right", className)}>
        <p className="inline-flex items-center gap-1.5 text-[8.5px] font-semibold tracking-[0.9px] text-[#067647] uppercase">
          <ShieldCheck className="h-3 w-3" strokeWidth={2.2} aria-hidden />
          Disahkan secara digital
        </p>
        {/* The line a signature rests on. There is no pen mark, and the block
            does not pretend there is — the seal above is the signature. */}
        <div className="mt-1.5 w-full max-w-64 border-t border-[#1d2939]" />
        <p className="mt-1 w-full max-w-64 text-[12px] leading-tight font-bold text-[#1d2939]">
          {name}
        </p>
        {/* The office under the name, as the form has it — and only when one
            has been set: a "—" here would read as a missing label rather than
            as a fact nobody has supplied. */}
        {signature.signerTitle && (
          <p className="w-full max-w-64 text-[10.5px] leading-tight text-[#1d2939]">
            {signature.signerTitle}
          </p>
        )}
        <p className="w-full max-w-64 text-[10px] text-[#667085]">{when(signature.signedAt)}</p>
        <p className="mt-0.5 w-full max-w-64 font-mono text-[8.5px] text-[#98a2b3]">
          {signature.alg} · kunci {key}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[12px] border border-success-line bg-success-soft py-3.5 pr-3.5 pl-4",
        className,
      )}
    >
      {/* A stamped edge rather than a second border: the card is a status, and
          the accent is what makes it read as sealed rather than as a notice. */}
      <span className="absolute inset-y-0 left-0 w-[3px] bg-[#067647]" aria-hidden />
      <div className="flex items-start gap-3">
        <ShieldCheck
          className="mt-0.5 h-5 w-5 shrink-0 text-success-ink"
          strokeWidth={2}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.9px] text-success-ink uppercase">
            Disahkan secara digital
          </p>
          <p className="mt-1 text-[15px] leading-tight font-bold text-ink">{name}</p>
          {signature.signerTitle && (
            <p className="text-[12.5px] leading-tight text-ink-2">{signature.signerTitle}</p>
          )}
          <p className="mt-1 text-[12px] text-ink-3">
            {when(signature.signedAt)}
            <span className="mx-1.5 text-ink-4">·</span>
            <span className="font-mono text-[11px] text-ink-4">
              {signature.alg} · kunci {key}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
