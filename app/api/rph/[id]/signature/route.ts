import { type NextRequest, NextResponse } from "next/server";
import { ms } from "@/lib/i18n/ms";
import { requireDbUser, schoolIdFor } from "@/lib/server/auth/guard";
import { adminDb } from "@/lib/server/db";
import type { Jawatan } from "@/lib/types";

/**
 * GET /api/rph/[id]/signature — the signature sealing a plan, if any.
 *
 * Returns the *material* — envelope, signature, public key — rather than a
 * verdict, so the client can verify it with `lib/signature` itself. A seal the
 * browser merely trusts is worth less than one it checks, and it means a
 * doctorable API response would be caught by the render rather than displayed.
 *
 * `erph.rph_signature`'s own SELECT policy already scopes this, but this
 * handler holds the secret key and bypasses RLS — so the scope is checked
 * here too, through `erph.may_supervise`, which is the same predicate the
 * policy uses. A Guru Besar reaches every plan; a GPK only their supervised
 * teachers; everyone their own.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The office as it is written on paper — "Penolong Kanan HEM", never the
 * `erph.jawatan` slug. Anything the enum does not recognise becomes `null`
 * rather than a string nobody can read on a sheet a district officer holds.
 */
function jawatanLabel(value: string | null | undefined): string | null {
  if (!value || !(value in ms.jawatan)) return null;
  return ms.jawatan[value as Jawatan];
}

export interface SignaturePayload {
  envelope: unknown;
  signature: string;
  publicKey: string;
  alg: string;
  signedAt: string;
  signerName: string | null;
  /**
   * The signer's office as printed — "Penolong Kanan HEM", "Guru Besar" —
   * read from `erph.user.jawatan`, or `null` when nobody has set one.
   *
   * Printed beneath their name on the cover sheet: a signature with a name but
   * no office under it is a name anyone could have typed, and the district
   * reading the sheet has no way to tell which. `null` stays `null` rather
   * than becoming a guess, so a missing office shows as "—".
   */
  signerTitle: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "ID tidak sah" }, { status: 400 });
  }

  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ error: "Akaun ini tiada sekolah" }, { status: 400 });
  }

  const { data: doc, error: docErr } = await gate.db
    .from("rph_document")
    .select("id, school_id, owner_id")
    .eq("id", id)
    .eq("school_id", schoolId)
    // `.is(…, null)`, not `.eq(…, false)`. `deleted_at` is a timestamptz —
    // PostgREST rejects a boolean against it outright, so the comparison never
    // reached the database and every call answered 500, including on a document
    // that plainly exists.
    .is("deleted_at", null)
    .maybeSingle();

  if (docErr) {
    console.error("[signature] document read failed:", docErr.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }
  const row = doc as { id: string; school_id: string; owner_id: string } | null;
  if (!row) return NextResponse.json({ signature: null });

  // `may_supervise` takes the *actor* as the identity, which for the service
  // key is nobody — so this runs with the caller's own id attached.
  const { data: allowed, error: scopeErr } = await adminDb(gate.user.id).rpc("may_supervise", {
    p_school: row.school_id,
    p_owner: row.owner_id,
  });
  if (scopeErr) {
    console.error("[signature] scope check failed:", scopeErr.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }
  // 404, not 403: a stranger should not learn this plan exists.
  if (!allowed) return NextResponse.json({ signature: null });

  const { data, error } = await gate.db
    .from("rph_signature")
    .select(
      "envelope, signature, public_key, alg, signed_at, signer_id, " +
        "signer:signer_id(full_name, jawatan)",
    )
    .eq("document_id", id)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[signature] read failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  const sig = data as {
    envelope: unknown;
    signature: string;
    public_key: string;
    alg: string;
    signed_at: string;
    signer_id: string;
    signer: { full_name: string; jawatan: string | null } | null;
  } | null;

  if (!sig) return NextResponse.json({ signature: null });

  // The office rides along on the same embedded read as the name. It used to
  // come from `school_member.title`, a free-text column nothing ever wrote —
  // which is why every cover sheet printed "—" beneath a signature the school
  // had actually made. `erph.user.jawatan` is the one the administrator sets,
  // and the join to `erph.user` is the same row the name is already read from.
  const payload: SignaturePayload = {
    envelope: sig.envelope,
    signature: sig.signature,
    publicKey: sig.public_key,
    alg: sig.alg,
    signedAt: sig.signed_at,
    signerName: sig.signer?.full_name ?? null,
    signerTitle: jawatanLabel(sig.signer?.jawatan),
  };

  return NextResponse.json({ signature: payload });
}
