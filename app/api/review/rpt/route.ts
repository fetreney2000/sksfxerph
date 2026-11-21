import { type NextRequest, NextResponse } from "next/server";
import { requireReviewer, schoolIdFor } from "@/lib/server/auth/guard";

/** All saved sessions; scope is applied explicitly because the key bypasses RLS. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireReviewer(request);
  if ("error" in gate) return gate.error;
  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] });

  let ids: string[] | null = null;
  if (gate.user.role !== "guru_besar") {
    const { data, error } = await gate.db
      .from("school_member")
      .select("user_id")
      .eq("school_id", schoolId)
      .eq("supervisor_id", gate.user.id)
      .eq("is_active", true);
    if (error)
      return NextResponse.json({ error: "Gagal memuatkan penyeliaan." }, { status: 500 });
    ids = (data ?? []).map((row: { user_id: string }) => row.user_id);
    if (!ids.length) return NextResponse.json({ items: [] });
  }

  let query = gate.db
    .from("rpt_link")
    .select("id, owner_id, session, title, url, owner:owner_id(full_name)")
    .eq("school_id", schoolId);
  if (ids) query = query.in("owner_id", ids);
  const ordered = query.order("id", { ascending: true });
  const items: {
    id: string;
    owner_id: string;
    session: string;
    title: string;
    url: string;
    owner: { full_name: string } | null;
  }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await ordered.range(offset, offset + 999);
    if (error)
      return NextResponse.json({ error: "Gagal memuatkan pautan RPT." }, { status: 500 });
    const page = (data ?? []) as unknown as typeof items;
    items.push(...page);
    if (page.length < 1000) break;
  }
  return NextResponse.json({ items });
}
