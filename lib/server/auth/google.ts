/**
 * What a Google ID token is allowed to prove about a teacher.
 *
 * Kept separate from the route that calls it because every rule here is the
 * kind that quietly stops being enforced when it is inlined into a handler and
 * someone refactors around it. Nothing in this file touches the network or the
 * database: given claims and rows, it says what follows.
 *
 * ## The three rules that matter
 *
 * 1. **`hd` must be present and must match.** Google's own documentation: the
 *    domain of the `email` claim is *insufficient* to show the account is
 *    managed by an organisation. `hd` is only issued for Google Workspace
 *    accounts, and **its absence means the account is not one** — so a missing
 *    `hd` is a rejection, not a "skip the check". That is the difference
 *    between "teachers at this school" and "anyone with a Gmail address".
 *
 * 2. **`email_verified` must be true.** An unverified address is one the signer
 *    merely *claims*; linking an account to it would hand the school's records
 *    to whoever controls it.
 *
 * 3. **`sub` is the key, not the email.** Google states email can change; `sub`
 *    cannot. Email is used exactly once — to find the row to link on the first
 *    sign-in — and never again.
 *
 * The signature itself is *not* checked here. That is the caller's job with
 * Google's own library: hand-rolling JWKS rotation is a known source of
 * malleability bugs, and this module would only ever see claims that already
 * passed it.
 */

export const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

export interface GoogleClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  hd?: unknown;
  iss?: unknown;
  exp?: unknown;
}

export type Rejection =
  | "missing-sub"
  | "wrong-issuer"
  | "expired"
  | "no-workspace-domain"
  | "wrong-domain"
  | "missing-email"
  | "unverified-email";

export type Checked =
  | { ok: true; sub: string; email: string }
  | { ok: false; reason: Rejection };

/**
 * Malay, for the two a teacher can act on.
 *
 * The rest are deliberately unmapped — "wrong issuer" and "expired" are not
 * things anyone at a school can fix, and saying so would only add noise to a
 * message that already tells them what to do.
 */
export const REJECTION_TEXT: Record<Rejection, string> = {
  "missing-sub": "Akaun Google tidak mengenal pasti anda. Cuba log masuk semula.",
  "wrong-issuer": "Token Google tidak sah.",
  expired: "Sesi Google tamat tempoh. Sila cuba lagi.",
  "no-workspace-domain":
    "Akaun Google ini bukan akaun sekolah KPM. Gunakan akaun @moe-dl.edu.my anda, atau log masuk dengan kata laluan.",
  "wrong-domain":
    "Akaun Google ini bukan daripada domain sekolah yang dibenarkan. Gunakan akaun @moe-dl.edu.my anda.",
  "missing-email": "Akaun Google tidak berkongsi alamat e-mel.",
  "unverified-email": "Alamat e-mel Google ini belum disahkan.",
};

/**
 * Structural checks on an ID token whose signature has already been verified.
 *
 * `aud` is not re-checked here — `verifyIdToken` takes the audience and rejects
 * a token minted for a different client before it returns anything.
 */
export function checkGoogleClaims(
  claims: GoogleClaims,
  opts: { domain: string; now?: Date },
): Checked {
  const sub = typeof claims.sub === "string" ? claims.sub.trim() : "";
  if (!sub) return { ok: false, reason: "missing-sub" };

  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) {
    return { ok: false, reason: "wrong-issuer" };
  }

  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  const now = opts.now ?? new Date();
  if (exp * 1000 <= now.getTime()) return { ok: false, reason: "expired" };

  // Present-and-equal, never "absent means fine". Google issues `hd` only to
  // Workspace accounts, so a token without it is a consumer account however
  // convincing its email looks.
  const hd = typeof claims.hd === "string" ? claims.hd.trim() : "";
  if (!hd) return { ok: false, reason: "no-workspace-domain" };
  if (hd.toLowerCase() !== opts.domain.trim().toLowerCase()) {
    return { ok: false, reason: "wrong-domain" };
  }

  const email = typeof claims.email === "string" ? claims.email.trim() : "";
  if (!email) return { ok: false, reason: "missing-email" };
  if (claims.email_verified !== true) return { ok: false, reason: "unverified-email" };

  return { ok: true, sub, email };
}

/** The columns this looks at, and nothing else. */
export interface AccountRow {
  id: string;
  email: string | null;
  google_sub: string | null;
}

export type Resolution =
  /** Already linked to this Google identity — sign in. */
  | { kind: "registered"; row: AccountRow }
  /** Email matches an account nobody has linked yet — pin `sub` and sign in. */
  | { kind: "link"; row: AccountRow }
  /** No matching account, or one already tied to a *different* identity. */
  | { kind: "not-registered" };

/**
 * Which account, if any, this Google identity may become.
 *
 * Auto-provisioning is deliberately absent. Every teacher in the ministry has
 * an `@moe-dl.edu.my` address, so "create an account if none exists" would let
 * any of them walk into this school's records by typing its URL. The pentadbir
 * creates accounts; Google only proves that the person holding one is who they
 * say they are.
 *
 * The third case is worth spelling out: an account whose email matches but is
 * already linked to a *different* `sub` does not get signed in as that person.
 * It means the address now belongs to someone else, and resolving it as a
 * sign-in would be account takeover by inheritance.
 */
export function resolveAccount(
  identity: { sub: string; email: string },
  rows: readonly AccountRow[],
): Resolution {
  const sub = identity.sub.toLowerCase();
  const email = identity.email.toLowerCase();

  const linked = rows.find((r) => r.google_sub?.toLowerCase() === sub);
  if (linked) return { kind: "registered", row: linked };

  // Case-insensitive because the login route and the seed both treat email
  // that way, and an exact match would silently fail for `Nurul@…`.
  const byEmail = rows.filter((r) => r.email?.toLowerCase() === email);
  if (byEmail.some((r) => r.google_sub !== null)) return { kind: "not-registered" };

  const unlinked = byEmail.find((r) => r.google_sub === null);
  return unlinked ? { kind: "link", row: unlinked } : { kind: "not-registered" };
}
