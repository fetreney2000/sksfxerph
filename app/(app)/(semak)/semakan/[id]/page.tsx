"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import type { DocumentRow } from "@/app/api/rph/route";
import { RphPaper } from "@/components/rph/rph-paper";
import { StatusBadge } from "@/components/rph/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { handleExpiredSession } from "@/lib/client/auth-session";
import { longDate } from "@/lib/date";
import { useSchool } from "@/lib/hooks/use-school";
import { useSession } from "@/lib/hooks/use-session";
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
  const session = useSession();
  const school = useSchool();

  const [plan, setPlan] = React.useState<PlanRow | null>(null);
  const [teacherName, setTeacherName] = React.useState("");
  const [state, setState] = React.useState<"loading" | "ok" | "missing" | "error">("loading");

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
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          Cetak
        </Button>
      </div>

      <RphPaper
        payload={normalisePayload(plan.payload)}
        session={session}
        schoolName={school.name}
        teacherName={teacherName}
        planClassName={className}
        subjectName={plan.subject?.nama ?? plan.subject_code}
        planDate={plan.plan_date}
        slotTime={plan.slot_time ?? "07:30"}
      />
    </div>
  );
}
