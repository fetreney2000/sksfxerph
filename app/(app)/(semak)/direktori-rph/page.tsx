"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { StatusBadge } from "@/components/rph/status-badge";
import { useUser } from "@/components/shell/user-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabaseConfigured } from "@/lib/config";
import { type ReviewPlanLight, useReviewPlans } from "@/lib/hooks/use-remote";
import { isPastReviewWeek } from "@/lib/review-week";
import { submitRph } from "@/lib/rpc";
import { decide } from "@/lib/signature/review";

export default function DirektoriRphPage() {
  const { items, loading, assigned, error, refetch } = useReviewPlans();
  const { id: userId } = useUser();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string[]>([]);
  const sessions = [...new Set(items.map((item) => item.session))].sort().reverse();
  async function approveWeek(plans: ReviewPlanLight[], teacher: string, week: number) {
    const eligible = plans.filter(
      (p) => (p.status === "draft" || p.status === "submitted") && isPastReviewWeek(p.planDate),
    );
    if (!eligible.length || busy) return;
    if (
      !window.confirm(
        `Sahkan ${eligible.length} RPH bagi ${teacher}, minggu ${week}? Setiap RPH akan ditandatangani. Pastikan anda telah menyemak kandungannya.`,
      )
    )
      return;
    setBusy(true);
    const messages: string[] = [];
    let approved = 0;
    try {
      for (const plan of eligible) {
        let submittedDraft = false;
        try {
          const response = await fetch(`/api/rph/${encodeURIComponent(plan.id)}`);
          if (!response.ok) throw new Error("RPH tidak dapat dibaca");
          const body = (await response.json()) as {
            item?: {
              owner_id: string;
              session: string;
              week_no: number;
              plan_date: string;
              status: string;
              version: number;
              payload: unknown;
            };
          };
          const doc = body.item;
          if (
            !doc ||
            doc.owner_id !== plan.teacherId ||
            doc.session !== plan.session ||
            doc.week_no !== week ||
            !isPastReviewWeek(doc.plan_date)
          ) {
            throw new Error("RPH telah berubah atau di luar minggu ini");
          }
          if (doc.status !== "draft" && doc.status !== "submitted")
            throw new Error("Status RPH telah berubah");
          let version = doc.version;
          if (doc.status === "draft") {
            const submitted = await submitRph(plan.id, false);
            if (!submitted?.ok || typeof submitted.version !== "number")
              throw new Error(submitted?.error ?? "Gagal menghantar draf");
            version = submitted.version;
            submittedDraft = true;
          }
          const decision = await decide({
            userId,
            documentId: plan.id,
            version,
            payload: doc.payload,
            decision: "sahkan",
          });
          if (!decision?.ok) throw new Error("Pengesahan tidak selesai");
          approved++;
        } catch (err) {
          messages.push(
            `${plan.planDate} · ${plan.subjectName}: ${err instanceof Error ? err.message : "Gagal mengesahkan"}${submittedDraft ? " (draf telah dihantar tetapi belum disahkan)" : ""}`,
          );
        }
      }
      setResult([`${approved} daripada ${eligible.length} RPH disahkan.`, ...messages]);
    } finally {
      setBusy(false);
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    }
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Direktori RPH guru</h1>
        <p className="text-sm text-ink-3">Semua RPH, termasuk draf dan rekod sesi terdahulu.</p>
      </div>
      {result.length > 0 && (
        <div role="status" className="rounded-lg border border-border p-3 text-sm">
          {result.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
      <Card>
        <CardContent className="space-y-2 py-4">
          {loading && <p>Memuatkan direktori…</p>}
          {error && <p role="alert">Gagal memuatkan direktori RPH. Cuba muat semula.</p>}
          {!loading && !error && items.length === 0 && (
            <p>{assigned ? "Tiada RPH dijumpai." : "Tiada guru ditugaskan kepada anda."}</p>
          )}
          {sessions.map((session) => (
            <details key={session} className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer font-bold">Sesi {session}</summary>
              {[
                ...new Map(
                  items
                    .filter((p) => p.session === session)
                    .map((p) => [p.teacherId, p.teacherName]),
                ).entries(),
              ]
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([teacherId, name]) => {
                  const plans = items.filter(
                    (p) => p.session === session && p.teacherId === teacherId,
                  );
                  const weeks = [...new Set(plans.map((p) => p.weekNo))].sort((a, b) => b - a);
                  return (
                    <details key={teacherId} className="ml-3 mt-2 border-l border-border pl-3">
                      <summary className="cursor-pointer font-semibold">{name}</summary>
                      {weeks.map((week) => (
                        <details key={week} className="ml-3 mt-2 border-l border-border pl-3">
                          <summary className="cursor-pointer">Minggu {week}</summary>
                          {(() => {
                            const weekPlans = plans.filter((p) => p.weekNo === week);
                            const eligible = weekPlans.filter(
                              (p) =>
                                (p.status === "draft" || p.status === "submitted") &&
                                isPastReviewWeek(p.planDate),
                            );
                            return (
                              <div className="py-2">
                                <Button
                                  size="sm"
                                  disabled={
                                    busy || !supabaseConfigured || eligible.length === 0
                                  }
                                  onClick={() => void approveWeek(weekPlans, name, week)}
                                >
                                  {busy
                                    ? "Memproses…"
                                    : `Semak dan sahkan (${eligible.length})`}
                                </Button>
                                <p className="mt-1 text-xs text-ink-3">
                                  Draf dan RPH dihantar bagi minggu lepas sahaja. Semak setiap
                                  RPH sebelum mengesahkan.
                                </p>
                              </div>
                            );
                          })()}
                          <ul className="space-y-2 py-2">
                            {plans
                              .filter((p) => p.weekNo === week)
                              .map((p) => (
                                <li
                                  key={p.id}
                                  className="flex flex-wrap items-center gap-2 text-sm"
                                >
                                  <Link
                                    className="text-primary-ink underline"
                                    href={`/semakan/${p.id}`}
                                  >
                                    {p.planDate} · {p.subjectName} · {p.className}
                                  </Link>
                                  <StatusBadge status={p.status} />
                                </li>
                              ))}
                          </ul>
                        </details>
                      ))}
                    </details>
                  );
                })}
            </details>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
