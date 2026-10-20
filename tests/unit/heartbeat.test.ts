import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/heartbeat/route";

/**
 * The heartbeat, as an anonymous caller sees it.
 *
 * The endpoint exists to keep the Supabase project awake, so the probe has to
 * run for everyone — but what it *reports* does not. `db`, `actor`, `mode` and
 * `latency_ms` tell an attacker whether a deployment is live, whether it has
 * a database, and whether the secret key is wired up. That is reconnaissance
 * for the next attempt, not an answer to any question a caller should be
 * asking.
 */
const request = (authorization?: string) =>
  new NextRequest(
    new Request("http://localhost/api/heartbeat", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("the heartbeat", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("tells an anonymous caller only that it answered", async () => {
    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("keeps the deployment's internals out of the public answer", async () => {
    const body = (await (await GET(request())).json()) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual(["ok"]);
    for (const leak of ["db", "actor", "mode", "latency_ms", "ts"]) {
      expect(body).not.toHaveProperty(leak);
    }
  });

  it("reports the diagnostics to the holder of the secret", async () => {
    process.env.CRON_SECRET = "rahasia-cron";
    const res = await GET(request("Bearer rahasia-cron"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toHaveProperty("db");
    expect(body).toHaveProperty("mode");
    expect(body).toHaveProperty("latency_ms");
  });

  it("shows the diagnostics to nobody else", async () => {
    process.env.CRON_SECRET = "rahasia-cron";

    for (const header of ["Bearer salah", "Bearer rahasia-cron-tamahan", "rahasia-cron", ""]) {
      const body = (await (await GET(request(header || undefined))).json()) as Record<
        string,
        unknown
      >;
      expect(Object.keys(body)).toEqual(["ok"]);
    }
  });

  it("shows nothing at all when no secret is configured", async () => {
    const body = (await (await GET(request("Bearer apa-saja"))).json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(body)).toEqual(["ok"]);
  });
});
