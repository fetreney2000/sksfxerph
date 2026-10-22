import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { weekOfIso } from "@/lib/config";
import { requireAdministrator, schoolIdFor } from "@/lib/server/auth/guard";
import { invalidateCalendarCache } from "@/lib/server/calendar";

/**
 * GET / PATCH / DELETE /api/admin/calendar — which week a date range is.
 *
 * Reading is the ordinary member-scoped query (`calendar_read` lets any member
 * select it); both writes go through `erph.admin_set_calendar_week` /
 * `erph.admin_clear_calendar_week`, because a handler holding the secret key is
 * not stopped by RLS and a declared week constrains every teacher's dashboard,
 * not just the administrator's own.
 *
 * `session` is read from `school_setting` here rather than taken from the body.
 * It is half the table's primary key, so a caller who chose it could write
 * declarations into a year the school is not running — and the session switch
 * already has one place it may be changed from.
 */
const weekNo = z
  .number({ message: "Minggu diperlukan" })
  .int("Minggu mesti nombor bulat")
  .min(1, "Minggu: antara 1 dan 52")
  .max(52, "Minggu: antara 1 dan 52");

const date = z
  .string({ message: "Tarikh diperlukan" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarikh mesti dalam bentuk TTTT-BB-HH");

const patchSchema = z.object({
  weekNo,
  startDate: date,
  endDate: date,
  /** The administrator's own name for the week — `Minggu PTS`. */
  label: z.string().max(80, "Nama minggu: maksimum 80 aksara").nullish(),
  /**
   * The week number this Monday is declared under *today*, when the call is an
   * edit rather than a new declaration. The RPC deletes that row in the same
   * transaction; sending it wrong is refused, never silently applied.
   */
  fromWeekNo: weekNo.nullish(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ anchors: [], session: null });

  const { data: setting, error: settingError } = await gate.db
    .from("school_setting")
    .select("current_session")
    .eq("school_id", schoolId)
    .maybeSingle();
  if (settingError) {
    console.error("[admin] calendar session read failed:", settingError.message);
    return NextResponse.json(
      { error: "Kalendar minggu tidak dapat dimuatkan." },
      { status: 500 },
    );
  }
  const session = (setting as { current_session: string } | null)?.current_session ?? null;
  if (!session) return NextResponse.json({ anchors: [], session: null });

  const { data, error } = await gate.db
    .from("academic_calendar")
    .select("session, week_no, start_date, end_date, label")
    .eq("school_id", schoolId)
    .eq("session", session)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("[admin] calendar read failed:", error.message);
    return NextResponse.json(
      { error: "Kalendar minggu tidak dapat dimuatkan." },
      { status: 500 },
    );
  }
  return NextResponse.json({ anchors: data ?? [], session });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId)
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak sah" },
      { status: 422 },
    );
  }

  // A declaration may push numbering *forward*, never pull it back — and this
  // is the one the SQL cannot do: the grid it would have to compare against is
  // `TERM_START` in lib/config.ts, a TypeScript constant the database has never
  // heard of. Without it the neighbour checks below have nothing to bite on for
  // the *first* row, and declaring 6 April to be week 1 leaves week 2 meaning
  // 13 April (the anchor) while a Tuesday in March still resolves to week 2 on
  // the grid — one number, two different weeks, and a plan whose `plan_date`
  // falls outside its own `schoolDays(week)`.
  //
  // Server-side, the store is empty, so `weekOfIso` is exactly the grid's
  // answer — which is what it must be here; the loaded calendar would be the
  // thing being checked against.
  const gridWeek = weekOfIso(parsed.data.startDate);
  if (parsed.data.weekNo < gridWeek) {
    return NextResponse.json(
      {
        error: `Tarikh itu sudah dikira sebagai Minggu ${gridWeek}. Nombor minggu mesti ${gridWeek} atau lebih.`,
      },
      { status: 422 },
    );
  }

  const { data: setting } = await gate.db
    .from("school_setting")
    .select("current_session")
    .eq("school_id", schoolId)
    .maybeSingle();
  const session = (setting as { current_session: string } | null)?.current_session;
  if (!session) {
    return NextResponse.json({ error: "Sesi sekolah tidak ditetapkan." }, { status: 409 });
  }

  const { error } = await gate.db.rpc("admin_set_calendar_week", {
    p_school: schoolId,
    p_session: session,
    p_week_no: parsed.data.weekNo,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
    p_label: parsed.data.label ?? null,
    p_from_week_no: parsed.data.fromWeekNo ?? null,
  });
  if (error) {
    // The SQL messages are written for the person at the form, so they travel
    // through untouched into the toast — same as the rest of the admin routes.
    console.error("[admin] set calendar week failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  // Dropped rather than waited out: the administrator is looking at their own
  // dashboard now, and the server must not keep counting the old week behind it.
  invalidateCalendarCache(schoolId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdministrator(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId)
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });

  const raw = request.nextUrl.searchParams.get("weekNo");
  const weekNoParam = Number(raw);
  if (!raw || !Number.isInteger(weekNoParam) || weekNoParam < 1 || weekNoParam > 52) {
    return NextResponse.json({ error: "Minggu: antara 1 dan 52" }, { status: 422 });
  }

  const { data: setting } = await gate.db
    .from("school_setting")
    .select("current_session")
    .eq("school_id", schoolId)
    .maybeSingle();
  const session = (setting as { current_session: string } | null)?.current_session;
  if (!session) {
    return NextResponse.json({ error: "Sesi sekolah tidak ditetapkan." }, { status: 409 });
  }

  const { error } = await gate.db.rpc("admin_clear_calendar_week", {
    p_school: schoolId,
    p_session: session,
    p_week_no: weekNoParam,
  });
  if (error) {
    console.error("[admin] clear calendar week failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  invalidateCalendarCache(schoolId);
  return NextResponse.json({ ok: true });
}
