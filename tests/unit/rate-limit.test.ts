import { describe, expect, it } from "vitest";
import { clientIp, clientKey, rateLimit } from "@/lib/http/rate-limit";

/**
 * The rate limiter's identity.
 *
 * The limiter is the brake on the login route's account lockout, so the key
 * it buckets on has to be one the caller cannot choose. It used to be the
 * `sub` claim of an `Authorization` header — decoded, never verified — so a
 * caller could mint a fresh key per request and the limit never applied. That
 * turned the lockout into a one-request-per-window denial of service against
 * every account in the school.
 */

const forged = (sub: string) =>
  Buffer.from(JSON.stringify({ sub }), "utf8").toString("base64url");

describe("the rate limiter's client key", () => {
  it("ignores a bearer token it cannot verify", () => {
    const req = new Request("http://localhost/api/auth/login", {
      headers: {
        authorization: `Bearer ${forged("1")}`,
        "x-forwarded-for": "203.0.113.9",
      },
    });

    expect(clientKey(req, "anon")).toBe("ip:203.0.113.9");
  });

  it("gives two forged tokens the same bucket, not two", () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    const a = new Request("http://localhost/api/auth/login", {
      headers: { ...headers, authorization: `Bearer ${forged("1")}` },
    });
    const b = new Request("http://localhost/api/auth/login", {
      headers: { ...headers, authorization: `Bearer ${forged("2")}` },
    });

    expect(clientKey(a, "anon")).toBe(clientKey(b, "anon"));
  });

  it("takes the first hop of x-forwarded-for, so a school behind one proxy is not one bucket", () => {
    const req = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.4" },
    });

    expect(clientIp(req, "anon")).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then to the caller's fallback", () => {
    const real = new Request("http://localhost/api/auth/login", {
      headers: { "x-real-ip": "192.0.2.7" },
    });
    expect(clientIp(real, "anon")).toBe("192.0.2.7");

    const nothing = new Request("http://localhost/api/auth/login");
    expect(clientIp(nothing, "anon")).toBe("anon");
  });
});

describe("the limiter itself", () => {
  it("answers null until the window is exhausted, then refuses", () => {
    const key = `test:${crypto.randomUUID()}`;

    for (let i = 0; i < 60; i++) {
      expect(rateLimit(key)).toBeNull();
    }
    const refused = rateLimit(key);
    expect(refused).not.toBeNull();
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("retry-after")).toBeTruthy();
  });

  it("keeps one caller's flood out of another's bucket", () => {
    const noisy = `test:${crypto.randomUUID()}`;
    const quiet = `test:${crypto.randomUUID()}`;

    for (let i = 0; i < 60; i++) rateLimit(noisy);
    expect(rateLimit(noisy)).not.toBeNull();
    expect(rateLimit(quiet)).toBeNull();
  });
});
