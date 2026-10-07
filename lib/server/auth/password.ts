import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing — scrypt from Node's stdlib.
 *
 * No bcrypt/argon2 dependency: scrypt is memory-hard, in the standard library,
 * and adequate here (one school, tens of users). Parameters follow the RFC 7914
 * recommendation for interactive login (N=16384, r=8, p=1 ≈ 16 MB per guess),
 * which is what makes GPU cracking expensive.
 *
 * Format is PHC-like so the algorithm can be upgraded without a flag day:
 *
 *   scrypt$16384$8$1$<salt b64url>$<hash b64url>
 *
 * `verifyPassword` reads N/r/p from the stored string, so re-hashing with
 * stronger parameters on next login is a one-line change.
 */

const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024; // scrypt needs ~128·N·r bytes; headroom for p
const ALGO = "scrypt";

/** A fixed hash used to spend the same CPU time when a username doesn't exist. */
const DUMMY = `scrypt$${N}$${R}$${P}$${randomBytes(16).toString("base64url")}$${randomBytes(
  64,
).toString("base64url")}`;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `${ALGO}$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = (stored || DUMMY).split("$");
  if (parts.length !== 6 || parts[0] !== ALGO) return false;

  const [, n, r, p, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  try {
    const salt = Buffer.from(saltB64, "base64url");
    const expected = Buffer.from(hashB64, "base64url");
    if (expected.length === 0) return false;

    const actual = await scryptAsync(plain, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });

    // Same length is guaranteed by passing expected.length to scrypt.
    return timingSafeEqual(actual, expected);
  } catch {
    // Malformed stored hash or absurd parameters — deny, don't throw.
    return false;
  }
}

/**
 * Burn the same CPU as a real verification when the account doesn't exist, so
 * response timing doesn't reveal which usernames are registered.
 */
export async function verifyAgainstDummy(plain: string): Promise<false> {
  await verifyPassword(plain, DUMMY);
  return false;
}
