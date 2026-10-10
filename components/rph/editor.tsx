"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileDown,
  Plus,
  Save,
  Send,
  X,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { RphPaper } from "@/components/rph/rph-paper";
import { Badge } from "@/components/ui/badge";
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
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/field";
import { HelpHint } from "@/components/ui/help-hint";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import { currentWeek, mytIso, schoolCode, supabaseConfigured } from "@/lib/config";
import { longDate } from "@/lib/date";
import { db } from "@/lib/db";
import { LOCAL_OWNER_ID } from "@/lib/demo/seed";
import { useSchool } from "@/lib/hooks/use-school";
import { useSchoolClasses, useSchoolSubjects } from "@/lib/hooks/use-school-data";
import { useSession } from "@/lib/hooks/use-session";
import { useSignature } from "@/lib/hooks/use-signature";
import { ms } from "@/lib/i18n/ms";
import { takeImport } from "@/lib/import/pending";
import { RpcError, submitRph } from "@/lib/rpc";
import {
  type Aktiviti,
  completeness,
  emptyPayload,
  normalisePayload,
  type RphPayload,
  stepStatus,
} from "@/lib/schemas/rph";
import { currentSession } from "@/lib/session";
import { payloadHash, verifySignature } from "@/lib/signature";
import { commit } from "@/lib/sync/queue";
import type { RphDocument } from "@/lib/types";

/**
 * Download the plan as a KPM-formatted DOCX from /api/export.
 *
 * The route is pure JS (`docx`) so it works in local mode too — no Supabase
 * involved. On any failure we fall back to the browser print dialog, which
 * also produces a PDF, so an export is never a dead end.
 */
/**
 * The seal for an exported plan, or null.
 *
 * Verified here rather than passed through. The exported file is the artefact
 * most likely to reach someone who cannot ask the app about it, so the printed
 * signature has to be one this process actually checked — and an unverifiable
 * one is dropped rather than rendered, since a seal that cannot be confirmed
 * must not appear to confirm anything.
 */
async function loadSeal(documentId: string, payload: unknown) {
  try {
    const res = await fetch(`/api/rph/${documentId}/signature`, {
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const { signature } = (await res.json()) as { signature: SignaturePayload | null };
    if (!signature) return null;

    const envelope = signature.envelope as { hash?: unknown };
    const matches = envelope.hash === (await payloadHash(payload));
    const verified = await verifySignature(
      signature.publicKey,
      signature.envelope,
      signature.signature,
    );
    return matches && verified ? signature : null;
  } catch {
    // No seal is better than a failed export: the document is still correct,
    // it simply prints the blank reviewer line.
    return null;
  }
}

async function exportDocx(doc: RphDocument): Promise<void> {
  try {
    const seal = await loadSeal(doc.id, doc.payload);
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        document_id: doc.id,
        payload: doc.payload,
        session: doc.session,
        planDate: doc.planDate,
        className: doc.className,
        subjectName: doc.subjectName,
        signerName: seal?.signerName ?? undefined,
        signedAt: seal?.signedAt ?? undefined,
        signatureAlg: seal?.alg ?? undefined,
        signatureKey: seal?.publicKey ?? undefined,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`export failed: ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `RPH-${doc.className.replace(/\s+/g, "-")}-${doc.planDate}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("RPH dimuat turun sebagai DOCX");
  } catch {
    toast.info("Eksport gagal — membuka dialog cetak sebagai gantian");
    window.print();
  }
}

const STEPS = [
  { key: "profil", title: ms.editor.step1, sub: ms.editor.step1sub },
  { key: "dskp", title: ms.editor.step2, sub: ms.editor.step2sub },
  { key: "pdpc", title: ms.editor.step3, sub: ms.editor.step3sub },
  { key: "refleksi", title: ms.editor.step4, sub: ms.editor.step4sub },
] as const;

/** One fixable gap, phrased as a sentence and tied to the section that holds it. */
interface Note {
  section: number;
  field?: string;
  text: string;
  /**
   * `blocking` notes mirror the four 25-point checks in `completeness()` —
   * there is no open blocking note exactly when the score is 100, so the
   * badge, the meter and this list can never contradict each other.
   *
   * Non-blocking notes come from `stepStatus()`, which is deliberately
   * stricter (the stepper and the reviewer checklist also want the activity's
   * *murid* column filled) but is not part of the submit gate. They are shown
   * muted so a green "Sedia dihantar" can coexist with a useful nudge.
   */
  blocking: boolean;
}

function notes(payload: RphPayload): Note[] {
  const has = (s?: string) => !!s?.trim();
  const out: Note[] = [];
  const add = (n: Note) => {
    out.push(n);
  };

  if (!has(payload.standard_kandungan))
    add({ section: 1, field: "f-188949", text: ms.editor.missing.sk, blocking: true });
  if (!has(payload.standard_pembelajaran))
    add({ section: 1, field: "f-907255", text: ms.editor.missing.sp, blocking: true });
  if (!has(payload.objektif))
    add({ section: 1, field: "f-675227", text: ms.editor.missing.objektif, blocking: true });
  // An activity list whose first entry is a blank separator is not an empty
  // list — asking for "at least one" is not the same as asking for "the first".
  if (!payload.aktiviti.some((a) => has(a.nama)))
    add({ section: 2, text: ms.editor.missing.noAktiviti, blocking: true });
  if (!has(payload.kriteria_kejayaan))
    add({ section: 2, field: "f-kriteria", text: ms.editor.missing.kriteria, blocking: true });
  if (!has(payload.refleksi))
    add({ section: 3, field: "f-270580", text: ms.editor.missing.refleksi, blocking: true });

  return out;
}

/** What `?template=` and `?reuse=` preload into the plan that does not exist yet. */
interface SeedSource {
  payload: RphPayload;
  subjectCode?: string;
  subjectName?: string;
}

/**
 * Load the source for an unsaved plan, or `null` for a plain blank one.
 *
 * Every failure path returns `null` rather than throwing: a template someone
 * else has since deleted, or a week with nothing in it, should open an empty
 * editor — not an error page for a convenience feature. Offline, Dexie still
 * answers for `reuse`, so the command works with no network at all.
 */
async function loadSeed(templateId?: string, reuse?: boolean): Promise<SeedSource | null> {
  if (templateId) {
    try {
      const res = await fetch("/api/templates", { credentials: "same-origin" });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        items: { id: string; payload: RphPayload; subject_code: string | null }[];
      };
      const template = body.items.find((t) => t.id === templateId);
      if (!template) return null;
      return {
        payload: template.payload,
        subjectCode: template.subject_code ?? undefined,
      };
    } catch {
      return null;
    }
  }

  if (reuse) {
    try {
      const docs = await db.documents
        .where("[ownerId+session]")
        .equals([LOCAL_OWNER_ID, currentSession()])
        .toArray();
      // The newest *written* plan from last week — an untouched blank from a
      // previous "RPH baharu" would seed this one with nothing at all.
      const source = docs
        .filter((d) => d.weekNo === currentWeek() - 1 && completeness(d.payload) > 0)
        .sort((a, b) => (a.planDate < b.planDate ? 1 : -1))[0];
      if (!source) return null;
      return {
        payload: source.payload,
        subjectCode: source.subjectCode,
        subjectName: source.subjectName,
      };
    } catch {
      return null;
    }
  }

  return null;
}

export function RphEditor({ docId }: { docId?: string }) {
  const router = useRouter();
  const params = useParams();
  const id = docId ?? (typeof params.id === "string" ? params.id : undefined);

  /**
   * `useLiveQuery` is what makes the dashboard update the instant the editor
   * saves — both screens subscribe to the same Dexie row, no global store.
   *
   * The discriminated return matters: `undefined` alone can't tell "still
   * loading" apart from "document doesn't exist", and showing a teacher a
   * bogus "not found" while IndexedDB is warming up is a real bug.
   */
  const found = useLiveQuery(async () => {
    // No id is "not saved yet", not "nothing here". The editor opens blank and
    // the teacher's first explicit save is what creates the row — opening the
    // penyunting must never leave a document behind that nobody chose to write.
    if (!id) return { state: "unsaved" as const };
    const doc = await db.documents.get(id);
    // Normalised on read. Dexie holds whatever was saved, and a plan written
    // before the template reshape carries no `kriteria_kejayaan` — which is
    // how opening an existing RPH from the archive crashed the editor on the
    // first field that assumed it existed.
    return doc
      ? { state: "ok" as const, doc: { ...doc, payload: normalisePayload(doc.payload) } }
      : { state: "missing" as const };
  }, [id]);

  const persisted = found?.state === "ok" ? found.doc : undefined;

  const { items: classes } = useSchoolClasses();
  const { items: subjects } = useSchoolSubjects();

  /**
   * A document that exists only in React state — no id in the URL, no row in
   * Dexie, nothing for the sync queue to send.
   *
   * It becomes real when the teacher presses Simpan, and not before. Seeded
   * once the class list has arrived, because `class_id` is a foreign key the
   * server checks: inventing a placeholder would produce a plan that looks
   * saved and is rejected on every flush.
   */
  const [pending, setPending] = React.useState<RphDocument | null>(null);
  const [seeded, setSeeded] = React.useState(false);

  React.useEffect(() => {
    const cls = classes[0];
    const subject = subjects[0];
    if (id || seeded || !cls) return;

    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      // An imported .docx wins over a template or last week's plan: the
      // teacher chose that file moments ago, which is more specific than
      // anything else that could be offered here.
      const imported = takeImport();
      // `loadSeed` is skipped entirely when an import is present, so the two
      // never both contribute a field and leave the teacher wondering which
      // one a value came from.
      const loaded = imported
        ? null
        : await loadSeed(params.get("template") ?? undefined, params.get("reuse") === "1");
      if (cancelled) return;

      const now = Date.now();
      setPending({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `local-${now}`,
        schoolCode,
        ownerId: LOCAL_OWNER_ID,
        classId: cls.id,
        className: cls.nama,
        subjectCode: loaded?.subjectCode ?? subject?.code ?? "MAT",
        subjectName: loaded?.subjectName ?? subject?.nama ?? "Matematik",
        session: currentSession(),
        weekNo: currentWeek(),
        planDate: mytIso(),
        slotTime: imported?.slotTime ?? "07:30",
        slotTimeEnd: imported?.slotTimeEnd ?? "12:40",
        status: "draft",
        // A template or last week's plan arrives *here*, not in the database —
        // readable, editable and discardable before anything exists.
        payload: imported?.payload ?? loaded?.payload ?? emptyPayload(),
        version: 1,
        clientUpdatedAt: now,
        createdAt: now,
      });
      setSeeded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, seeded, classes, subjects]);

  /** What is on screen: a stored plan, or one that has not been saved yet. */
  const live = persisted ?? pending;

  // The school year the preview prints — server-resolved, so the paper shows
  // the same year the plan will be filed under.
  const session = useSession();
  const school = useSchool();

  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  /** Writes in flight — the indicator only speaks up if one is genuinely slow. */
  const inFlight = React.useRef(0);

  // ── Tier B: the gated wizard became four collapsible sections ────────────
  /** Which tab owns the narrow layout; ignored at `xl` where both columns dock. */
  const [tab, setTab] = React.useState<"form" | "preview">("form");
  /** Docked preview visibility on wide screens (persisted). */
  const [dockOpen, setDockOpen] = React.useState(true);
  /** Which section the nav marks as current. */
  const [active, setActive] = React.useState(0);
  /** `null` = no choice yet, so we open the first section that still needs work. */
  const [openSet, setOpenSet] = React.useState<ReadonlySet<number> | null>(null);
  /** Height of the app topbar — content-driven, so it cannot be a magic number. */
  const [topInset, setTopInset] = React.useState(64);
  /** Phone-width: only one section open at a time (measured after mount). */
  const [narrow, setNarrow] = React.useState(false);
  /** Stored-section preference consumed exactly once per document. */
  const [resumed, setResumed] = React.useState(false);
  /** Stable across every write to this row — safe as an effect dependency. */
  const liveId = live?.id;

  /**
   * What the teacher has typed, held *synchronously*.
   *
   * `live` only changes once Dexie confirms a write, so a render landing
   * between two fast keystrokes restores the older stored value — and React
   * resets a controlled input to its prop, which discards the characters
   * typed since. Tracing this showed `SLOW typing: ok / FAST typing: lost`.
   * The draft makes the keystroke the source of truth; the store is where it
   * lands.
   */
  const [draft, setDraft] = React.useState<RphPayload | null>(null);
  const payload = draft ?? live?.payload ?? emptyPayload();
  /** The newest payload, readable from callbacks without a stale closure. */
  const payloadRef = React.useRef(payload);
  payloadRef.current = payload;

  /**
   * The seal, if this plan has one.
   *
   * Keyed on the *persisted* id: an unsaved plan cannot have been sealed by
   * anyone, so asking would be a request for a document that does not exist.
   * `payload` rather than `deferredPayload` so the verification compares
   * against what is actually on screen, not what React has caught up to.
   */
  const signature = useSignature(persisted?.id, payload);

  /**
   * The A4 preview is a couple of hundred nodes; deferring it lets React paint
   * the field you are typing in first and catch the document up a beat later.
   * A hook, so it lives with the others — before the loading guards.
   */
  const deferredPayload = React.useDeferredValue(payload);

  // A different document is a different draft. The effect only re-runs when
  // the id changes, so this can never clobber something being typed.
  React.useEffect(() => {
    if (liveId) setDraft(null);
  }, [liveId]);

  const update = React.useCallback(
    async (patch: Partial<RphDocument>) => {
      if (!live) return;

      const next: RphDocument = {
        ...live,
        ...patch,
        payload: payloadRef.current,
        clientUpdatedAt: Date.now(),
      };

      // An unsaved plan is edited in memory only. `commit()` would put a row in
      // Dexie *and* enqueue a network sync — exactly the write the teacher has
      // not asked for yet, and the reason opening the penyunting used to leave
      // a document behind.
      if (!persisted) {
        setPending(next);
        return;
      }

      inFlight.current += 1;
      // A Dexie put lands in about a millisecond — well inside a frame.
      // Toggling the indicator for those would strobe it on every keystroke,
      // so it only turns amber if a write is still pending after 200ms:
      // routine success stays quiet, slowness becomes conspicuous.
      const showIfSlow = window.setTimeout(() => {
        if (inFlight.current > 0) setSaving(true);
      }, 200);
      try {
        // commit() writes to Dexie first (optimistic, instant for the UI) and
        // queues the network sync in the background. `payload` comes from the
        // ref, never from `patch` — a doc-level patch carrying an older payload
        // would revert whatever was typed after it was built.
        await commit(next);
      } finally {
        inFlight.current -= 1;
        window.clearTimeout(showIfSlow);
        if (inFlight.current === 0) setSaving(false);
      }
    },
    [live, persisted],
  );

  /**
   * The one action that turns a blank slate into a document.
   *
   * Everything above deliberately does not do this — which is the whole point
   * of the change. A teacher who opens the penyunting, changes their mind and
   * navigates away must leave nothing behind: no empty draft in the dashboard,
   * no orphan row for a reviewer, no queued sync. Pressing Simpan is what says
   * "this is a plan".
   */
  const [creating, setCreating] = React.useState(false);
  const savePlan = React.useCallback(async () => {
    if (!pending || persisted || creating) return;
    setCreating(true);
    try {
      const draft = { ...pending, payload: payloadRef.current };

      // `rph_document` is keyed on teacher×class×subject×session×week×date, so
      // a second plan for the same slot does not coexist — the server resolves
      // it onto the first and the teacher's work silently becomes someone
      // else's row, with no warning anywhere.
      //
      // Dexie holds the server's plans too now (`lib/sync/pull`), so this
      // catches a plan written on another device as well as this one. Offering
      // the existing plan is better than refusing outright: the common case is
      // a teacher who forgot they already started it.
      const clash = await db.documents
        .where("[ownerId+session+weekNo+planDate]")
        .equals([draft.ownerId, draft.session, draft.weekNo, draft.planDate])
        .filter(
          (d) =>
            d.id !== draft.id &&
            d.classId === draft.classId &&
            d.subjectCode === draft.subjectCode,
        )
        .first();

      if (clash) {
        toast.error(
          `Anda sudah mempunyai RPH untuk ${draft.className} · ${draft.subjectName} pada ` +
            `${draft.planDate}. Buka yang sedia ada, atau tukar kelas, subjek atau tarikh.`,
        );
        router.push(`/editor/${clash.id}`);
        return;
      }

      // Carry the id into the URL so a refresh, a bookmark or a share lands on
      // the row that now exists rather than back on the blank editor.
      await commit(draft);
      router.replace(`/editor/${draft.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan rancangan");
    } finally {
      setCreating(false);
    }
  }, [pending, persisted, creating, router]);

  const updatePayload = React.useCallback(
    (patch: Partial<RphPayload>) => {
      const next = { ...payloadRef.current, ...patch };
      // Update the ref *before* anything can render — `update()` reads it to
      // build the commit — then let React render from the same value.
      payloadRef.current = next;
      setDraft(next);
      void update({ payload: next });
    },
    [update],
  );

  // Park the section nav flush under the topbar. Measured rather than assumed:
  // the breadcrumb makes the topbar much taller on a phone.
  React.useEffect(() => {
    const bar = document.querySelector<HTMLElement>("header.sticky");
    if (!bar) return;
    const apply = () => setTopInset(Math.ceil(bar.getBoundingClientRect().height));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  // Phone width: a second open section is just more scrolling, so the
  // accordion becomes exclusive below md. Measured after mount — using it for
  // the first paint would cause a hydration mismatch for no benefit.
  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  // Scroll-spy: the nav highlights whichever section is actually in view, so
  // it answers "where am I" without the teacher having to look up. Re-keyed on
  // the id rather than the row, or it would re-observe on every keystroke.
  React.useEffect(() => {
    // No document yet — there is nothing to observe.
    if (!liveId) return;
    const els = STEPS.map((_, i) => document.getElementById(`bahagian-${i}`)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      () => {
        // Recompute over every section, not just the ones that changed in
        // this batch: otherwise a section that merely nudged into the band can
        // win over the one actually sitting at the top of it.
        const bandTop = topInset + 56;
        const bandBottom = window.innerHeight * 0.55;
        let best: HTMLElement | null = null;
        let bestTop = Number.POSITIVE_INFINITY;
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.bottom > bandTop && r.top < bandBottom && r.top < bestTop) {
            best = el;
            bestTop = r.top;
          }
        }
        if (best) setActive(Number(best.id.split("-")[1]));
      },
      // Fires when any section crosses an edge of that same band.
      { rootMargin: `-${topInset + 56}px 0px -45% 0px` },
    );
    els.forEach((el) => {
      io.observe(el);
    });
    return () => io.disconnect();
  }, [liveId, topInset]);

  // Restore the docked-preview preference. Written only from the toggle so
  // mount-time effects cannot clobber it before they read it.
  React.useEffect(() => {
    if (window.localStorage.getItem("erph-preview") === "0") setDockOpen(false);
  }, []);

  const toggleDock = React.useCallback(() => {
    setDockOpen((wasOpen) => {
      const next = !wasOpen;
      window.localStorage.setItem("erph-preview", next ? "1" : "0");
      return next;
    });
  }, []);

  // Resume: on a tool opened every week, the section the teacher left open is
  // a better bet than re-deriving "first incomplete". The guess only runs when
  // nothing is stored for this document (or storage is unavailable).
  React.useEffect(() => {
    if (!live || resumed) return;
    setResumed(true);
    try {
      const raw = window.localStorage.getItem(`erph-rph-sesi:${live.id}`);
      if (raw) {
        const saved = JSON.parse(raw) as { active?: number; open?: number[] };
        if (Array.isArray(saved.open)) {
          setActive(Number.isInteger(saved.active) ? (saved.active as number) : 0);
          setOpenSet(new Set(saved.open));
          return;
        }
      }
    } catch {
      // corrupt or unavailable storage — fall through to the default
    }
    const f = stepStatus(live.payload ?? emptyPayload());
    const flags = [f.profil, f.dskp, f.pdpc, f.refleksi];
    const i = flags.findIndex((done) => !done);
    const start = i === -1 ? 0 : i;
    setActive(start);
    setOpenSet(new Set([start]));
  }, [live, resumed]);

  // Persist that choice. Keyed on the *id*, not the row, so a keystroke's
  // Dexie emit cannot turn this into a synchronous storage write per character.
  React.useEffect(() => {
    if (!liveId || openSet === null) return;
    try {
      window.localStorage.setItem(
        `erph-rph-sesi:${liveId}`,
        JSON.stringify({ active, open: [...openSet] }),
      );
    } catch {
      // private mode or quota — losing a preference is not worth an error
    }
  }, [liveId, active, openSet]);

  const toggleSection = React.useCallback(
    (i: number) => {
      setActive(i);
      setOpenSet((prev) => {
        const open = prev ?? new Set<number>();
        // Phone width: a second open section is just more scrolling, so the
        // accordion goes exclusive — tapping the only open one still closes it.
        if (narrow) {
          const soleOpen = open.size === 1 && open.has(i);
          return new Set(soleOpen ? [] : [i]);
        }
        const next = new Set(open);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
    },
    [narrow],
  );

  /**
   * Reveal a section (and optionally focus one field in it), then scroll to it.
   *
   * The target only exists once React has committed the reveal, so the scroll
   * runs a frame later. Reduced-motion users get an instant jump.
   */
  const goTo = React.useCallback(
    (section: number, field?: string) => {
      setActive(section);
      setOpenSet((prev) => {
        if (narrow) return new Set([section]);
        const next = new Set(prev ?? []);
        next.add(section);
        return next;
      });
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.requestAnimationFrame(() => {
        const target =
          (field ? document.getElementById(field) : null) ??
          document.getElementById(`bahagian-${section}`);
        if (!target) return;
        target.scrollIntoView({
          behavior: smooth ? "smooth" : "auto",
          block: field ? "center" : "start",
        });
        if (field) target.focus({ preventScroll: true });
      });
    },
    [narrow],
  );

  // A stored plan: still loading, or gone.
  if (id && found === undefined) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-ink-4">Memuatkan…</CardContent>
      </Card>
    );
  }

  if (id && found?.state !== "ok") {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="mb-4 text-ink-3">RPH tidak dijumpai.</p>
          <Button onClick={() => router.push("/minggu")}>Kembali ke Minggu Ini</Button>
        </CardContent>
      </Card>
    );
  }

  // An unsaved plan cannot be built until the class list has arrived: the
  // document carries a real `class_id`, and a placeholder would produce
  // something that looks saved and is rejected on every sync.
  if (!live) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-ink-4">
          Menyiapkan penyunting…
        </CardContent>
      </Card>
    );
  }

  const score = completeness(payload);
  const flags = stepStatus(payload);
  const stepDone = [flags.profil, flags.dskp, flags.pdpc, flags.refleksi];
  const doneCount = stepDone.filter(Boolean).length;

  const allNotes = notes(payload);
  const blocking = allNotes.filter((n) => n.blocking);
  const ready = blocking.length === 0;

  const onSubmit = async (force: boolean) => {
    // Offline-first: never block a teacher on a network hiccup. When we ARE
    // online and configured, the server is authoritative — `submit_rph` owns
    // the completeness rule (backend §3.3 decision 4) and may disagree with
    // our local meter. If it refuses, show the gate instead of submitting.
    if (supabaseConfigured && navigator.onLine) {
      try {
        const verdict = await submitRph(live.id, force);
        if (verdict && !verdict.ok) {
          setSubmitOpen(true);
          return;
        }
      } catch (err) {
        // An expired session is NOT a network hiccup: claiming "Dihantar"
        // while the server never saw it would be a lie. Send them to re-auth.
        if (err instanceof RpcError && err.isAuthFailure) {
          toast.error("Sesi anda telah tamat. Sila log masuk semula.");
          window.setTimeout(() => window.location.assign("/login"), 1200);
          return;
        }
        // Genuine network/DB hiccup: fall through and submit locally.
        // sync_rph applies the same 100% gate server-side, so this cannot
        // become a bypass — it just queues the submission for when we reconnect.
      }
    } else if (score < 100 && !force) {
      setSubmitOpen(true);
      return;
    }

    await update({ status: "submitted", submittedAt: Date.now(), grade: undefined });
    setSubmitOpen(false);
    toast.success(`Dihantar untuk semakan · status: ${ms.status.submitted}`);
    router.push("/minggu");
  };

  const open = openSet ?? new Set<number>();
  // One boolean drives both layouts: below xl it is the active tab, at xl it
  // is the docked column. Resolved with class precedence rather than a
  // media-query hook, so the first paint is already correct on both.
  const previewCls = !dockOpen
    ? tab === "preview"
      ? "block"
      : "hidden"
    : tab === "form"
      ? "hidden xl:block"
      : "block";

  return (
    <>
      {/* ══ Sticky section nav ════════════════════════════════════════════
          Replaces the horizontal stepper: chips stay reachable from anywhere
          on the page, and `topInset` parks them flush under the (content-
          driven) topbar instead of guessing its height. */}
      <nav
        aria-label={ms.editor.sectionNav}
        className="sticky z-20 mb-4 flex items-center gap-1.5 overflow-x-auto rounded-[14px] border border-border bg-surface/95 px-2 py-2 shadow-xs backdrop-blur-md"
        style={{ top: topInset }}
      >
        {STEPS.map((s, i) => {
          const done = stepDone[i];
          const current = active === i;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => goTo(i)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                current
                  ? "border-primary-soft-2 bg-primary-soft text-primary-ink"
                  : "border-border bg-surface text-ink-3 hover:border-border-strong hover:text-ink-2",
              )}
            >
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10.5px] font-bold",
                  done
                    ? "bg-success text-white"
                    : current
                      ? "bg-primary text-white"
                      : "bg-surface-3 text-ink-4",
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              {s.title}
            </button>
          );
        })}
        <button
          type="button"
          onClick={toggleDock}
          className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink-3 transition-colors hover:border-border-strong hover:text-ink-2 xl:flex"
        >
          {dockOpen ? ms.editor.hidePreview : ms.editor.showPreview}
        </button>
      </nav>

      <div className={cn("grid gap-6", dockOpen && "xl:grid-cols-[1fr_390px]")}>
        {/* `min-w-0` is load-bearing: grid items default to `min-width: auto`,
            so nowrap content would blow the track out and scroll the whole page
            sideways (it did, at 390/1280/1440). */}
        <div
          className={cn("flex min-w-0 flex-col gap-3", tab === "preview" && "hidden xl:flex")}
        >
          {/* Below xl the preview can never sit beside the form, so it becomes
              a tab instead of stacking thousands of pixels below the fields it
              is meant to preview. `xl:hidden` keeps this out of the docked
              layout without a media-query hook (and thus without hydration
              churn on first paint). */}
          <div className="flex gap-2 xl:hidden">
            {(
              [
                ["form", ms.editor.tabForm],
                ["preview", ms.editor.tabPreview],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={cn(
                  "flex-1 rounded-[10px] border px-3 py-2 text-[13px] font-semibold transition-colors",
                  tab === key
                    ? "border-primary-soft-2 bg-primary-soft text-primary-ink"
                    : "border-border bg-surface text-ink-3 hover:border-border-strong",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Document identity + completeness: one card, nothing nested. */}
          <section className="rounded-[14px] border border-border bg-surface px-4 py-4 shadow-sm">
            <div className="min-w-0">
              <h2 className="text-[15.5px] font-bold tracking-[-0.3px]">
                {live.className} · {live.subjectName}
              </h2>
              <p className="text-[12.5px] text-ink-3">
                <span className="num">
                  {longDate(live.planDate)} · {live.slotTime}
                </span>
              </p>
            </div>
            <div className="mt-3.5 border-t border-dashed border-border pt-3.5">
              {/* Completeness — flat, not a box: count, meter, then the exact gaps.
                Each gap is a link to the field that fixes it (WCAG G139). */}
              <div className="mb-0">
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[13.5px] font-semibold">{ms.editor.completeness}</span>
                  <span className="num text-[12.5px] text-ink-3">
                    — {doneCount} daripada 4 bahagian · {score}%
                  </span>
                  <HelpHint label="Keluargaan dokumen">
                    Empat bahagian wajib mengikut borang RPH sekolah: (1) Standard Kandungan +
                    Standard Pembelajaran, (2) objektif + Kriteria Kejayaan, (3)
                    sekurang-kurangnya satu Aktiviti PdPC, (4) refleksi. Setiap bahagian = 25%.
                  </HelpHint>
                  <span className="ml-auto">
                    <Badge variant={ready ? "success" : "warning"}>
                      {ready ? ms.editor.ready : ms.editor.notReady}
                    </Badge>
                  </span>
                </div>

                <Progress value={score} tone={ready ? "success" : "primary"} />

                {allNotes.length > 0 && (
                  <ul
                    className="mt-2 flex flex-col gap-0.5"
                    aria-label={ms.editor.attentionLabel}
                  >
                    {allNotes.map((n) => (
                      <li key={n.text}>
                        <button
                          type="button"
                          onClick={() => goTo(n.section, n.field)}
                          className={cn(
                            "group flex w-full items-baseline gap-2 rounded-md py-1 text-left transition-colors hover:text-primary-ink",
                            n.blocking ? "text-ink-2" : "text-ink-3",
                          )}
                        >
                          <span
                            aria-hidden
                            className={n.blocking ? "text-warning-ink" : "text-ink-4"}
                          >
                            •
                          </span>
                          <span className="text-[12.5px]">{n.text}</span>
                          <span className="ml-auto shrink-0 text-[11.5px] text-ink-4 group-hover:text-primary-ink">
                            {STEPS[n.section]?.title} →
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {/* The four sections. Only the open ones mount their fields, so a
              collapsed section costs nothing and the whole document structure
              stays on screen at once. */}
          {STEPS.map((s, i) => (
            <SectionCard
              key={s.key}
              index={i}
              title={s.title}
              sub={s.sub}
              done={stepDone[i] ?? false}
              open={open.has(i)}
              onToggle={() => toggleSection(i)}
              scrollMarginTop={topInset + 56}
            >
              {i === 0 && (
                <StepProfil
                  doc={live}
                  payload={payload}
                  onPatch={update}
                  onPayload={updatePayload}
                />
              )}
              {i === 1 && <StepDskp payload={payload} onPatch={updatePayload} />}
              {i === 2 && <StepPdPc payload={payload} onPatch={updatePayload} />}
              {i === 3 && <StepRefleksi payload={payload} onPatch={updatePayload} />}
            </SectionCard>
          ))}
        </div>

        <div className={cn("min-w-0 self-start", previewCls)}>
          {/* The tab bar lives in the *form* column, so this is the only way
              back once the preview takes over on a phone. `xl:hidden` keeps it
              out of the docked layout. */}
          <button
            type="button"
            onClick={() => setTab("form")}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-[13px] font-semibold text-ink-2 shadow-xs transition-colors hover:bg-surface-3 xl:hidden"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.9} aria-hidden />
            {ms.editor.backToForm}
          </button>

          <div className="mb-3 flex items-center gap-1.5">
            <span className="text-[12.5px] font-bold tracking-[0.6px] text-ink-4 uppercase">
              {ms.editor.preview}
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // Browser print → "Save as PDF". Works offline, and RphPaper is
                // styled at KPM proportions (§4.2(8) print/PDF fidelity).
                toast.info("Pilih “Simpan sebagai PDF” dalam dialog cetak");
                window.print();
              }}
            >
              <Download className="h-4 w-4" strokeWidth={1.9} aria-hidden />
              PDF
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void exportDocx(live)}>
              <FileDown className="h-4 w-4" strokeWidth={1.9} aria-hidden />
              DOCX
            </Button>
          </div>

          <RphPaper
            payload={deferredPayload}
            session={session}
            schoolName={school.name}
            signature={signature.signature}
            signatureState={signature.state}
          />
        </div>
      </div>

      {/* ══ Single sticky action bar ═════════════════════════════════════
          Save state lives here (not 300px up in the header) next to the one
          primary action. No Back/Next: the section nav is the navigation, and
          no "Simpan draf" — autosave is the save. */}
      <div className="sticky bottom-14 z-10 flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-3 shadow-sm lg:bottom-0">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
          <span
            className={cn(
              "h-1.75 w-1.75 rounded-full",
              creating || saving ? "bg-warning" : persisted ? "bg-success" : "bg-ink-4",
            )}
            aria-hidden
          />
          {creating || saving
            ? "Menyimpan…"
            : persisted
              ? `${ms.status.saving} · ${ms.status.online}`
              : "Belum disimpan"}
        </span>

        {/* Nothing exists to submit until Simpan creates the row — offering
            "Hantar" here would send an id that is not in the database. */}
        {persisted ? (
          <Button className="ml-auto" onClick={() => void onSubmit(false)}>
            <Send className="h-4 w-4" strokeWidth={1.9} aria-hidden /> {ms.editor.submit}
          </Button>
        ) : (
          <Button className="ml-auto" disabled={creating} onClick={() => void savePlan()}>
            <Save className="h-4 w-4" strokeWidth={1.9} aria-hidden />
            {creating ? "Menyimpan…" : "Simpan rancangan"}
          </Button>
        )}
      </div>

      {/* ══ Submit gate dialog ══════════════════════════════════════════ */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        {/* <DialogContent> is not optional decoration: Dialog is Radix's Root,
            which renders its children inline. Without the Portal/Overlay wrapper
            these three blocks were landing in the page grid as a phantom
            "Hantar RPH untuk semakan?" section. */}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hantar RPH untuk semakan?</DialogTitle>
            <DialogDescription>
              {live.className} · {live.subjectName} · {longDate(live.planDate)}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <dl className="text-[13.5px]">
              <Row k="Bahagian lengkap" v={`${doneCount} / 4`} />
              <Row k="Penyemak" v="Zulkifli · GPK Pentadbiran" />
              <Row k="Kesiapan" v={`${score}%`} tone={ready ? "ok" : "warn"} />
            </dl>
            {/* Generated from the same list the form shows — the two can never
              disagree about *what* is missing. */}
            {blocking.length > 0 && (
              <div className="mt-3.5 flex gap-2.5 rounded-[10px] border border-warning-line bg-warning-soft p-3 text-[12.5px] leading-[1.55] text-warning-ink">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  strokeWidth={1.9}
                  aria-hidden
                />
                <div>
                  <p className="font-semibold">
                    {ms.editor.incompleteHeading(blocking.length)}
                  </p>
                  <ul className="mt-1 list-disc pl-4">
                    {blocking.map((n) => (
                      <li key={n.text}>{n.text}</li>
                    ))}
                  </ul>
                  <p className="mt-1.5">{ms.editor.draftWarning}</p>
                </div>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSubmitOpen(false)}>
              Batal
            </Button>
            <Button variant="danger" onClick={() => void onSubmit(true)}>
              Hantar sebagai draf
            </Button>
            <Button
              onClick={() => {
                setSubmitOpen(false);
                goTo(3);
              }}
            >
              Lengkapkan sekarang
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * One collapsible section of the RPH.
 *
 * The header always shows "Langkah n · <name>" plus a status pill, so the
 * whole document is scannable while collapsed — a teacher should be able to
 * read what is missing without opening anything. Content only mounts when
 * open, so a collapsed section costs nothing.
 */
function SectionCard({
  index,
  title,
  sub,
  done,
  open,
  onToggle,
  scrollMarginTop,
  children,
}: {
  index: number;
  title: string;
  sub: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  scrollMarginTop: number;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`bahagian-${index}`}
      // Clears the topbar + section nav when a note deep-links here.
      style={{ scrollMarginTop }}
      className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm"
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
        >
          <span
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold",
              done
                ? "border-success bg-success text-white"
                : "border-border-strong bg-surface-2 text-ink-3",
            )}
            aria-hidden
          >
            {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-bold tracking-[-0.15px]">
              Langkah {index + 1} · {title}
            </span>
            <span className="block truncate text-[11.5px] text-ink-4">{sub}</span>
          </span>
          <Badge variant={done ? "success" : "warning"} dot={false}>
            {done ? ms.editor.sectionDone : ms.editor.notReady}
          </Badge>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-ink-4 transition-transform",
              open && "rotate-180",
            )}
            strokeWidth={2}
            aria-hidden
          />
        </button>
      </h3>
      {open && <div className="border-t border-border px-4 py-4">{children}</div>}
    </section>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-border py-2 last:border-b-0">
      <dt className="text-ink-3">{k}</dt>
      <dd
        className="font-bold"
        style={{
          color:
            tone === "ok"
              ? "var(--color-success-ink)"
              : tone === "bad"
                ? "var(--color-danger-ink)"
                : tone === "warn"
                  ? "var(--color-warning-ink)"
                  : undefined,
        }}
      >
        {v}
      </dd>
    </div>
  );
}

/* ══ Step 1 · Profil ═══════════════════════════════════════════════════ */

function StepProfil({
  doc,
  payload,
  onPatch,
  onPayload,
}: {
  doc: RphDocument;
  payload: RphPayload;
  onPatch: (p: Partial<RphDocument>) => void;
  onPayload: (p: Partial<RphPayload>) => void;
}) {
  // Live lists, not fixtures: a subject or class the administrator switches off
  // must stop appearing here, and one they add must show up without a redeploy.
  const { items: classes } = useSchoolClasses();
  const { items: subjects } = useSchoolSubjects();

  // A plan written against a class or subject that has since been archived
  // still has to render its own value — otherwise the select would silently
  // show the first option while `doc.classId` kept pointing somewhere else, and
  // the next save would not change anything the user could see.
  const classOptions = React.useMemo(() => {
    if (classes.some((c) => c.id === doc.classId)) return classes;
    return [...classes, { id: doc.classId, nama: doc.className, session: doc.session }];
  }, [classes, doc.classId, doc.className, doc.session]);

  const subjectOptions = React.useMemo(() => {
    if (subjects.some((s) => s.code === doc.subjectCode)) return subjects;
    return [
      ...subjects,
      { code: doc.subjectCode, nama: doc.subjectName, curriculum: "KSSR" as const },
    ];
  }, [subjects, doc.subjectCode, doc.subjectName]);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="f-14796">{ms.editor.subject}</Label>
          <Select
            id="f-14796"
            value={doc.subjectCode}
            onChange={(e) => {
              const code = e.target.value;
              const name = subjects.find((s) => s.code === code)?.nama ?? doc.subjectName;
              onPatch({ subjectCode: code, subjectName: name });
            }}
          >
            {subjectOptions.map((s) => (
              <option key={s.code} value={s.code}>
                {s.nama}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-733697">{ms.editor.class}</Label>
          <Select
            id="f-733697"
            value={doc.classId}
            onChange={(e) => {
              const cls = classes.find((c) => c.id === e.target.value);
              if (cls) onPatch({ classId: cls.id, className: cls.nama });
            }}
          >
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nama}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-807586">{ms.editor.date}</Label>
          <Input
            id="f-807586"
            type="date"
            className="num"
            value={doc.planDate}
            onChange={(e) => onPatch({ planDate: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="f-795300">{ms.editor.time}</Label>
          <Input
            id="f-795300"
            type="time"
            className="num"
            value={doc.slotTime}
            onChange={(e) => onPatch({ slotTime: e.target.value })}
          />
        </div>
        <div>
          {/* Masa Tamat. The printed form has it, so the plan has to carry it
              — a single start time leaves the page to invent an end time. */}
          <Label htmlFor="f-masa-tamat">Masa Tamat</Label>
          <Input
            id="f-masa-tamat"
            type="time"
            className="num"
            value={doc.slotTimeEnd}
            onChange={(e) => onPatch({ slotTimeEnd: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="f-995730">Fasa / Tema</Label>
          <Input
            id="f-995730"
            value={payload.fasa_tema ?? ""}
            placeholder="Nombor & Operasi"
            onChange={(e) => onPayload({ fasa_tema: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="f-bidang">Bidang</Label>
          <Input
            id="f-bidang"
            value={payload.bidang ?? ""}
            placeholder="Sifat Manusia"
            onChange={(e) => onPayload({ bidang: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="f-tajuk">Tajuk</Label>
          <Input
            id="f-tajuk"
            value={payload.tajuk ?? ""}
            placeholder="Keutamaan dalam keluarga"
            onChange={(e) => onPayload({ tajuk: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/* ══ Step 2 · DSKP ════════════════════════════════════════════════════ */

function StepDskp({
  payload,
  onPatch,
}: {
  payload: RphPayload;
  onPatch: (p: Partial<RphPayload>) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <Label required htmlFor="f-188949">
          {ms.editor.standardKandungan}
        </Label>
        <Input
          id="f-188949"
          value={payload.standard_kandungan}
          placeholder="cth. 3.1 Mengenal, membaca dan menulis semula nombor"
          onChange={(e) => onPatch({ standard_kandungan: e.target.value })}
        />
        {payload.standard_kandungan.trim() === "" && (
          <FieldError>Standard Kandungan diperlukan sebelum dihantar.</FieldError>
        )}
      </div>

      <div>
        <Label required htmlFor="f-907255">
          {ms.editor.standardPembelajaran}
        </Label>
        <Input
          id="f-907255"
          value={payload.standard_pembelajaran}
          placeholder="cth. 3.1.1 Menulis semula nombor hingga 100,000"
          onChange={(e) => onPatch({ standard_pembelajaran: e.target.value })}
        />
        {payload.standard_pembelajaran.trim() === "" && (
          <FieldError>Standard Pembelajaran diperlukan sebelum dihantar.</FieldError>
        )}

        <div className="mt-3.5">
          <Label required htmlFor="f-675227">
            {ms.editor.objective}
          </Label>
          <Textarea
            id="f-675227"
            value={payload.objektif}
            placeholder="Murid dapat…"
            onChange={(e) => onPatch({ objektif: e.target.value })}
          />
          {payload.objektif.trim() === "" && (
            <FieldError>Objektif diperlukan sebelum dihantar.</FieldError>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══ Step 3 · PdPc ════════════════════════════════════════════════════ */

function StepPdPc({
  payload,
  onPatch,
}: {
  payload: RphPayload;
  onPatch: (p: Partial<RphPayload>) => void;
}) {
  const setAktiviti = (i: number, patch: Partial<Aktiviti>) => {
    onPatch({
      aktiviti: payload.aktiviti.map((a, idx) => (idx === i ? { ...a, ...patch } : a)),
    });
  };

  return (
    <div>
      <Label className="mb-0" required>
        {ms.editor.activities}
      </Label>
      {/* The printed form is a list of names, not a timed table of teacher and
          student actions — so the form asks for names. A sub-item is printed
          indented behind a hyphen, which is how the school writes a heading
          with its contents beneath it ("Permainan Dalaman" → "- Catur"). */}
      <p className="mb-2.5 mt-1 text-[12.5px] leading-[1.55] text-ink-4">
        Nama aktiviti mengikut urutan yang dicetak. Tandakan sebagai sub-aktiviti untuk
        dipaparkan berindeks dengan tanda hubung.
      </p>

      <div className="grid gap-2">
        {payload.aktiviti.map((a, i) => (
          <div
            /* biome-ignore lint/suspicious/noArrayIndexKey: append/delete only —
               never reordered, and each row is a controlled input with no
               per-item state. The rule guards against state following an item
               across a reorder; a delete unmounts the button that caused it, so
               there is no state to misplace. */
            key={i}
            className="flex items-center gap-2"
          >
            <Input
              id={`f-aktiviti-${i}-nama`}
              value={a.nama}
              placeholder={a.sub ? "Catur" : "Senamrobik"}
              onChange={(e) => setAktiviti(i, { nama: e.target.value })}
              aria-label={`Aktiviti PdPC ${i + 1}`}
              className={a.sub ? "pl-7" : undefined}
            />
            <button
              type="button"
              aria-pressed={a.sub}
              onClick={() => setAktiviti(i, { sub: !a.sub })}
              className={
                "shrink-0 rounded-[7px] border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors " +
                (a.sub
                  ? "border-primary-soft-2 bg-primary-soft text-primary-ink"
                  : "border-border-strong bg-surface text-ink-3 hover:border-primary")
              }
              title={a.sub ? "Tanggalkan sub-aktiviti" : "Jadikan sub-aktiviti"}
            >
              Sub
            </button>
            <button
              type="button"
              className="shrink-0 rounded-[7px] p-1.5 text-ink-4 transition-colors hover:bg-danger-soft hover:text-danger-ink"
              onClick={() => onPatch({ aktiviti: payload.aktiviti.filter((_, x) => x !== i) })}
              aria-label={`Buang aktiviti ${i + 1}`}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          </div>
        ))}
        {payload.aktiviti.length === 0 && (
          <p className="rounded-[10px] border border-dashed border-border-strong px-3 py-6 text-center text-[12.5px] text-ink-4">
            Tiada aktiviti lagi.
          </p>
        )}
      </div>

      <Button
        variant="secondary"
        size="sm"
        className="mt-2.5 self-start"
        onClick={() => onPatch({ aktiviti: [...payload.aktiviti, { nama: "", sub: false }] })}
      >
        <Plus className="h-4 w-4" strokeWidth={2.1} aria-hidden /> Tambah aktiviti
      </Button>

      <div className="mt-5">
        <Label required htmlFor="f-kriteria">
          {ms.editor.successCriteria}
        </Label>
        <Textarea
          id="f-kriteria"
          value={payload.kriteria_kejayaan}
          placeholder="Murid menunjukkan…"
          onChange={(e) => onPatch({ kriteria_kejayaan: e.target.value })}
        />
        {payload.kriteria_kejayaan.trim() === "" && (
          <FieldError>Kriteria Kejayaan diperlukan sebelum dihantar.</FieldError>
        )}
      </div>
    </div>
  );
}

/* ══ Step 4 · Refleksi ════════════════════════════════════════════════ */

function StepRefleksi({
  payload,
  onPatch,
}: {
  payload: RphPayload;
  onPatch: (p: Partial<RphPayload>) => void;
}) {
  // One field, not a pair. The printed form has a Refleksi row and nothing
  // else in this section — Intervensi and EMK were on the KPM circular, not on
  // the school's template, so requiring them meant filling in content that
  // could never appear on the page anyone reads.
  return (
    <div>
      <Label required htmlFor="f-270580">
        {ms.editor.reflection}
      </Label>
      <Textarea
        id="f-270580"
        value={payload.refleksi}
        placeholder="Apa yang berlaku? Murid mana perlu perhatian?"
        onChange={(e) => onPatch({ refleksi: e.target.value })}
      />
      {payload.refleksi.trim() === "" && (
        <FieldError>Refleksi diperlukan sebelum dihantar.</FieldError>
      )}
    </div>
  );
}
