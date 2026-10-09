"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { openDraft } from "@/lib/actions/plans";
import { currentWeek } from "@/lib/config";
import { useSchoolClasses } from "@/lib/hooks/use-school-data";

/**
 * `/editor` with no id = "take me to the plan I should be working on".
 *
 * Resolves the most urgent draft (or returned plan) for the current week and
 * creates one if the week is empty — so the sidebar link and "RPH baharu"
 * both land somewhere useful without the user picking a class first.
 */
export default function EditorIndexPage() {
  const router = useRouter();
  const { items: classes, loading } = useSchoolClasses();
  const [state, setState] = React.useState<"resolving" | "empty" | "error">("resolving");

  React.useEffect(() => {
    // Wait for the class list rather than resolving against an empty one: with
    // no classes `openDraft` returns undefined, and this would report "empty"
    // for a week that is only empty because the fetch had not landed yet.
    if (loading || classes.length === 0) return;

    let cancelled = false;

    void (async () => {
      try {
        const doc = await openDraft(currentWeek(), classes);
        if (cancelled) return;
        if (doc) {
          router.replace(`/editor/${doc.id}`);
        } else {
          setState("empty");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classes, loading, router]);

  return (
    <Card>
      <CardContent className="py-12 text-center">
        {state === "error" ? (
          <>
            <p className="mb-4 text-ink-3">Gagal membuka penyunting.</p>
            <Button variant="secondary" onClick={() => router.push("/minggu")}>
              Kembali
            </Button>
          </>
        ) : (
          <p className="text-ink-4">Menyiapkan penyunting…</p>
        )}
      </CardContent>
    </Card>
  );
}
