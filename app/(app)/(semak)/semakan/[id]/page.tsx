"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Download, MessageSquareText, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import type { DocumentRow } from "@/app/api/rph/route";
import { FeedbackNotes } from "@/components/rph/feedback-notes";
import { ReviewHistory } from "@/components/rph/review-history";
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
import { db } from "@/lib/db";
import { useSchool } from "@/lib/hooks/use-school";
import { useSignature } from "@/lib/hooks/use-signature";
import { normalisePayload } from "@/lib/schemas/rph";
import type { FeedbackNote, ReviewNote, RphDocument, RphStatus } from "@/lib/types";

interface PlanRow extends DocumentRow {
  class_names: string[];
}

/** The local harness has no route handler; Dexie is the same document source. */
function fromLocal(doc: RphDocument): PlanRow {
  return {
    id: doc.id,
    owner_id: doc.ownerId,
    class_ids: doc.classIds,
    subject_code: doc.subjectCode,
    session: doc.session,
    week_no: doc.weekNo,
    plan_date: doc.planDate,
    slot_time: doc.slotTime,
    slot_time_end: doc.slotTimeEnd,
    status: doc.status,
    payload: doc.payload,
    version: doc.version,
    content_hash: null,
    created_at: new Date(doc.createdAt).toISOString(),
    updated_at: new Date(doc.clientUpdatedAt).toISOString(),
    submitted_at: doc.submittedAt ? new Date(doc.submittedAt).toISOString() : null,
    deleted_at: null,
    grade: doc.grade ?? null,
    reviewed_at: doc.reviewedAt ? new Date(doc.reviewedAt).toISOString() : null,
    class_names: doc.classNames,
    subject: { nama: doc.subjectName },
    rph_review: (doc.reviewHistory ?? []).map((note) => ({
      reviewer: note.reviewerName ? { full_name: note.reviewerName } : null,
      comment: note.comment,
      created_at: note.createdAt,
      grade: note.grade,
    })),
  };
}

/**
 * A plan opened from Semakan - the reviewer's "Buka penuh".
 *
 * The paper itself is read-only: the editor is the teacher's surface and stays
 * owner-only, so a reviewer opening someone else's plan lands here instead of
 * on its "RPH tidak dijumpai". The page carries the reviewer's own actions -
 * return a submitted plan with a feedback message, reopen an approval for a
 * Guru Besar, and export/print the sealed copy.
 */
export default function SemakanDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const school = useSchool();
  const { fullName, role } = useUser();
  const queryClient = useQueryClient();

  const [plan, setPlan] = React.useState<PlanRow | null>(null);
  const [teacherName, setTeacherName] = React.useState("");
  const [state, setState] = React.useState<"loading" | "ok" | "missing" | "error">("loading");
  const [exporting, setExporting] = React.useState(false);
  const [reopenOpen, setReopenOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [reopening, setReopening] = React.useState(false);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [feedback, setFeedback] = React.useState("");
  const [returning, setReturning] = React.useState(false);
  const [commentOpen, setCommentOpen] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [commenting, setCommenting] = React.useState(false);
  // Verified in the browser: the print path must not put an unchecked seal on
  // paper, and the server independently verifies the same material on export.
  const signature = useSignature(plan?.id, plan?.payload);

  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!supabaseConfigured) {
          const found = await db.documents.get(id);
          if (!live) return;
          if (!found) {
            setState("missing");
            return;
          }
          setPlan(fromLocal(found));
          // Dexie has no user directory on the client; the demo account is
          // the reviewer, not necessarily the plan owner.
          setTeacherName("Guru");
          setState("ok");
          return;
        }

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
  const reviewHistory: ReviewNote[] = [...(plan.rph_review ?? [])]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((review) => ({
      reviewerName: review.reviewer?.full_name ?? null,
      comment: review.comment,
      createdAt: review.created_at,
      grade: review.grade,
    }));
  const feedbackNotes: FeedbackNote[] = [...(plan.rph_feedback ?? [])]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((note) => ({
      authorName: note.author?.full_name ?? null,
      comment: note.comment,
      createdAt: note.created_at,
    }));
  const canReturn = plan.status === "submitted" && (role === "gpk" || role === "guru_besar");
  const canComment = role === "gpk" || role === "guru_besar";

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

  async function returnToTeacher() {
    if (!plan || returning || !feedback.trim()) return;
    setReturning(true);
    try {
      if (!supabaseConfigured) {
        const stored = await db.documents.get(plan.id);
        if (!stored) throw new Error("RPH tidak dijumpai.");
        if (stored.status !== "submitted") {
          throw new Error("RPH tidak dalam peringkat semakan.");
        }
        const now = Date.now();
        const note: ReviewNote = {
          reviewerName: fullName || "Penyemak",
          comment: feedback.trim(),
          createdAt: new Date(now).toISOString(),
          grade: 0,
        };
        const history = [note, ...(stored.reviewHistory ?? [])];
        await db.documents.put({
          ...stored,
          status: "returned",
          grade: 0,
          reviewedAt: now,
          reviewComment: note.comment,
          reviewerName: note.reviewerName,
          reviewHistory: history,
          clientUpdatedAt: now,
          version: stored.version + 1,
        });
        setPlan({
          ...plan,
          status: "returned",
          grade: 0,
          rph_review: history.map((entry) => ({
            reviewer: entry.reviewerName ? { full_name: entry.reviewerName } : null,
            comment: entry.comment,
            created_at: entry.createdAt,
            grade: entry.grade,
          })),
        });
      } else {
        const res = await fetch("/api/rpc/review", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            documentId: plan.id,
            decision: "hantar_balik",
            expectedVersion: plan.version,
            comment: feedback.trim(),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Pengembalian gagal (HTTP ${res.status}).`);
        }
        setPlan({ ...plan, status: "returned", grade: 0 });
      }
      setFeedbackOpen(false);
      setFeedback("");
      void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["review-plans"] });
      void queryClient.invalidateQueries({ queryKey: ["review-plan", plan.id] });
      toast.success("RPH dikembalikan kepada guru dengan maklum balas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pengembalian gagal.");
    } finally {
      setReturning(false);
    }
  }

  async function addComment() {
    if (!plan || commenting || !comment.trim()) return;
    setCommenting(true);
    try {
      const text = comment.trim();
      if (!supabaseConfigured) {
        const stored = await db.documents.get(plan.id);
        if (!stored) throw new Error("RPH tidak dijumpai.");
        const now = Date.now();
        const note: FeedbackNote = {
          authorName: fullName || "Penyemak",
          comment: text,
          createdAt: new Date(now).toISOString(),
        };
        const notes = [note, ...(stored.feedbackNotes ?? [])];
        await db.documents.put({ ...stored, feedbackNotes: notes, clientUpdatedAt: now });
        setPlan({
          ...plan,
          rph_feedback: notes.map((entry) => ({
            author: entry.authorName ? { full_name: entry.authorName } : null,
            comment: entry.comment,
            created_at: entry.createdAt,
          })),
        });
      } else {
        const res = await fetch("/api/rpc/comment", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentId: plan.id, comment: text }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Maklum balas gagal (HTTP ${res.status}).`);
        }
        setPlan({
          ...plan,
          rph_feedback: [
            {
              author: { full_name: fullName || "Penyemak" },
              comment: text,
              created_at: new Date().toISOString(),
            },
            ...(plan.rph_feedback ?? []),
          ],
        });
      }
      setCommentOpen(false);
      setComment("");
      void queryClient.invalidateQueries({ queryKey: ["review-plan", plan.id] });
      toast.success("Maklum balas dihantar kepada guru.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Maklum balas gagal.");
    } finally {
      setCommenting(false);
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
      void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["review-plans"] });
      void queryClient.invalidateQueries({ queryKey: ["review-plan", plan.id] });
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
        {canComment && (
          <Button size="sm" variant="secondary" onClick={() => setCommentOpen(true)}>
            <MessageSquareText className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
            Maklum balas
          </Button>
        )}
        {canReturn && (
          <Button
            size="sm"
            variant="danger"
            title="Kembalikan RPH kepada guru dengan maklum balas"
            onClick={() => setFeedbackOpen(true)}
          >
            <Undo2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Kembalikan
          </Button>
        )}
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

      <div data-print="screen">
        <ReviewHistory reviews={reviewHistory} />
        <FeedbackNotes notes={feedbackNotes} />
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

      <Dialog
        open={feedbackOpen}
        onOpenChange={(open) => {
          setFeedbackOpen(open);
          if (!open) setFeedback("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kembalikan RPH kepada guru?</DialogTitle>
            <DialogDescription>
              Maklum balas ini akan dihantar kepada guru sebagai sebab RPH ini dikembalikan. RPH
              akan menjadi boleh disunting semula.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="return-feedback">Maklum balas untuk guru</Label>
            <Textarea
              id="return-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={5}
              maxLength={2000}
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setFeedbackOpen(false);
                setFeedback("");
              }}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={returning || !feedback.trim()}
              onClick={() => void returnToTeacher()}
            >
              {returning ? "Mengembalikan…" : "Kembalikan dengan maklum balas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={commentOpen}
        onOpenChange={(open) => {
          setCommentOpen(open);
          if (!open) setComment("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Berikan maklum balas</DialogTitle>
            <DialogDescription>
              Maklum balas ini akan sampai kepada guru tanpa mengubah status RPH.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="reviewer-comment">Maklum balas untuk guru</Label>
            <Textarea
              id="reviewer-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={5}
              maxLength={2000}
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setCommentOpen(false);
                setComment("");
              }}
            >
              Batal
            </Button>
            <Button
              variant="secondary"
              disabled={commenting || !comment.trim()}
              onClick={() => void addComment()}
            >
              {commenting ? "Menghantar…" : "Hantar maklum balas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
