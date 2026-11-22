"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import type { DocumentRow } from "@/app/api/rph/route";
import { RphPaper } from "@/components/rph/rph-paper";
import { StatusBadge } from "@/components/rph/status-badge";
import { useUser } from "@/components/shell/user-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/field";
import { handleExpiredSession } from "@/lib/client/auth-session";
import { supabaseConfigured } from "@/lib/config";
import { longDate } from "@/lib/date";
import { useSchool } from "@/lib/hooks/use-school";
import { useSignature } from "@/lib/hooks/use-signature";
import { normalisePayload } from "@/lib/schemas/rph";
import type { RphStatus } from "@/lib/types";

interface PlanRow extends DocumentRow {
  class_names: string[];
}

/**
 * A plan opened from Semakan - the reviewer's "Buka penuh".
 *
 * Read-only on purpose: the editor is the teacher's surface and stays
 * owner-only, so a reviewer opening someone else's plan lands here instead
 * of on its "RPH tidak dijumpai". The paper is the same `RphPaper` the queue
 * renders, shown whole rather than beside the decision controls, with a
 * print button for the file.
 */
export default function SemakanDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const school = useSchool();
  const { role } = useUser();

  const [plan, setPlan] = React.useState<PlanRow | null>(null);
  const [teacherName, setTeacherName] = React.useState("");
  const [state, setState] = React.useState<"loading" | "ok" | "missing" | "error">("loading");
  const [exporting, setExporting] = React.useState(false);
  const [reopenOpen, setReopenOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [reopening, setReopening] = React.useState(false);
  // Verified in the browser: the print path must not put an unchecked seal on
  // paper, and the server independently verifies the same material on export.
  const signature = useSignature(plan?.id, plan?.payload);

  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/rph/${encodeURIComponent(id)}`, {
          credentials: "same-origin",
        });
        if (handleExpiredSession(res.status)) {
          router.replace("/login");
          return;
        }
        const body = (await res.json().catch(() => null)) as {
          item?: PlanRow;
          teacherName?: string;
        } | null;
        if (!live) return;
        if (res.status === 404 || !body?.item) {
          setState("missing");
          return;
        }
        if (!res.ok) {
          setState("error");
          return;
        }
        setPlan(body.item);
        setTeacherName(body.teacherName ?? "Guru");
        setState("ok");
      } catch {
        if (live) setState("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [id, router]);

  if (state === "loading") {
    return (
      <Card>
        <CardContent className="py-12 text-center text-ink-4">Memuatkan RPH…</CardContent>
      </Card>
    );
  }

  if (state !== "ok" || !plan) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="mb-4 text-ink-3">
            {state === "missing" ? "RPH tidak dijumpai." : "Ralat pelayan."}
          </p>
          <Button onClick={() => router.push("/semakan")}>Kembali ke Semakan</Button>
        </CardContent>
      </Card>
    );
  }

  const className = (plan.class_names ?? []).filter(Boolean).join(", ") || "-";

  async function exportDocx() {
    if (!plan || exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // In synced mode the server renders the stored row and its verified
          // seal; the body's payload is only the local-mode fallback.
          ...(supabaseConfigured ? { document_id: plan.id } : {}),
          payload: normalisePayload(plan.payload),
          session: plan.session,
          className,
          subjectName: plan.subject?.nama ?? plan.subject_code,
          planDate: plan.plan_date,
          slotTime: plan.slot_time ?? "07:30",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Eksport gagal (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RPH-${[className, plan.subject?.nama ?? plan.subject_code, plan.plan_date]
        .join("-")
        .replace(/[\\/:*?"<>|\s]+/g, "-")}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("RPH dimuat turun sebagai DOCX");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Eksport gagal.");
    } finally {
      setExporting(false);
    }
  }

  async function reopen() {
    if (!plan || reopening || !reason.trim()) return;
    setReopening(true);
    try {
      const res = await fetch("/api/rpc/unapprove", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: plan.id, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Pembatalan gagal (HTTP ${res.status}).`);
      }
      setPlan({ ...plan, status: "returned", grade: 0 });
      setReopenOpen(false);
      setReason("");
      toast.success("Pengesahan dibatalkan - RPH dikembalikan kepada guru.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pembatalan gagal.");
    } finally {
      setReopening(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div data-print="screen" className="mb-4 flex flex-wrap items-center gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link href="/semakan">‹ Semakan</Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-bold text-ink-1">
            {teacherName} · {className}
          </h1>
          <p className="text-xs text-ink-3">
            {plan.subject?.nama ?? plan.subject_code} ·{" "}
            <span className="num">
              {longDate(plan.plan_date)} · {plan.slot_time ?? "07:30"}
            </span>
          </p>
        </div>
        <StatusBadge
          status={plan.status as RphStatus}
          grade={plan.grade === 0 || plan.grade === 1 ? plan.grade : undefined}
        />
        {supabaseConfigured && plan.status === "approved" && role === "guru_besar" && (
          <Button size="sm" variant="danger" onClick={() => setReopenOpen(true)}>
            Batal pengesahan
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={exporting}
          onClick={() => void exportDocx()}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
          {exporting ? "Menyediakan…" : "Muat turun DOCX"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          Cetak
        </Button>
      </div>

      <RphPaper
        payload={normalisePayload(plan.payload)}
        session={plan.session}
        schoolName={school.name}
        teacherName={teacherName}
        planClassName={className}
        subjectName={plan.subject?.nama ?? plan.subject_code}
        planDate={plan.plan_date}
        slotTime={plan.slot_time ?? "07:30"}
        // Only a sealed plan carries a seal. A submitted or returned plan may
        // have an orphan signature row from a refused attempt; it must not
        // print as if the plan were approved.
        signature={plan.status === "approved" ? signature.signature : null}
        signatureState={plan.status === "approved" ? signature.state : "none"}
      />

      <Dialog
        open={reopenOpen}
        onOpenChange={(open) => {
          setReopenOpen(open);
          if (!open) setReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batal pengesahan RPH?</DialogTitle>
            <DialogDescription>
              RPH ini akan dikembalikan kepada guru untuk dibaiki, dan guru akan menerima sebab
              yang anda tulis. Tindakan ini direkodkan dalam log audit.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="reopen-reason">Sebab pembatalan</Label>
            <Textarea
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Contoh: kandungan yang disahkan bukan versi terakhir."
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setReopenOpen(false);
                setReason("");
              }}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={reopening || !reason.trim()}
              onClick={() => void reopen()}
            >
              {reopening ? "Membuka semula…" : "Kembalikan kepada guru"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
