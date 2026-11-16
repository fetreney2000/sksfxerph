import { describe, expect, it } from "vitest";
import { dbFailureMessage, isUuid, toClientError } from "@/lib/server/http/errors";

/**
 * The central error sanitizer.
 *
 * `error.message` straight from the database names constraints, tables and
 * SQLSTATEs - a schema map handed to whoever triggers it. The rule: an
 * authored plpgsql raise (P0001) is a sentence written for the person at the
 * form and passes through; everything else is infrastructure and gets the
 * generic line, with the full text in the server log.
 */

describe("toClientError", () => {
  it("passes an authored raise through untouched", async () => {
    const res = toClientError("[test]", {
      message: "RPH tidak dijumpai",
      code: "P0001",
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "RPH tidak dijumpai" });
  });

  it("hides a constraint violation behind the generic line", async () => {
    const res = toClientError("[test]", {
      message: 'duplicate key value violates unique constraint "rpt_link_owner_title_uniq"',
      code: "23505",
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Ralat pelayan." });
  });

  it("hides a PostgREST failure the same way", async () => {
    const res = toClientError("[test]", {
      message: "could not find the function erph.sync_rph(p_ops) in the schema cache",
      code: "PGRST202",
    });
    expect(await res.json()).toEqual({ error: "Ralat pelayan." });
  });

  it("hides a connection failure with no code at all", async () => {
    const res = toClientError("[test]", new Error("fetch failed"));
    expect(await res.json()).toEqual({ error: "Ralat pelayan." });
  });

  it("keeps the caller's status", async () => {
    const res = toClientError("[test]", { message: "x", code: "42501" }, 401);
    expect(res.status).toBe(401);
  });
});

describe("dbFailureMessage", () => {
  it("names a schema mismatch without leaking internals", () => {
    const msg = dbFailureMessage({
      message: "Could not find the 'content_hash' column of 'rph_document' in the schema cache",
      code: "PGRST204",
    });
    expect(msg).toContain("tidak sepadan");
    expect(msg).toContain("PGRST");
    expect(msg).not.toContain("content_hash");
  });

  it("names permission, reference and range failures by code", () => {
    expect(dbFailureMessage({ code: "42501" })).toContain("42501");
    expect(dbFailureMessage({ code: "23503" })).toContain("23503");
    expect(dbFailureMessage({ code: "23514" })).toContain("23514");
    expect(dbFailureMessage({ code: "23502" })).toContain("23502");
  });

  it("stays silent only when there is no code at all", () => {
    expect(dbFailureMessage(new Error("fetch failed"))).toBeNull();
    expect(dbFailureMessage(null)).toBeNull();
  });

  it("appends any other code verbatim - codes carry no schema", () => {
    expect(dbFailureMessage({ code: "PGRST200" })).toContain("PGRST200");
    expect(dbFailureMessage({ code: "57014" })).toContain("57014");
  });
});

describe("isUuid", () => {
  it("accepts a version-4 UUID in any case", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000002")).toBe(true);
    expect(isUuid("AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("bukan-uuid")).toBe(false);
    expect(isUuid("00000000-0000-4000-8000-00000000000")).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
