import { describe, expect, it } from "vitest";
import { mobileNavFor, navFor, routeMetaFor } from "@/components/shell/nav";
import { MEMBER_ROLES } from "@/lib/types";

const hrefsFor = (role: string) =>
  navFor(role).flatMap((group) => group.items.map((item) => item.href));

describe("navigation — the editor is an action, not a destination", () => {
  it("removes /editor from every role's navigation", () => {
    for (const role of MEMBER_ROLES) {
      expect(hrefsFor(role)).not.toContain("/editor");
    }
  });

  it("puts the draft badge on Minggu Ini, where the drafts are rows", () => {
    const week = navFor("guru_biasa")
      .flatMap((group) => group.items)
      .find((item) => item.href === "/minggu");

    expect(week?.badge).toBe("drafts");
  });

  it("still gives a teacher a way to the archive on mobile", () => {
    // The bottom bar is a subset of `navFor`; dropping "Tulis" left a phone
    // with only two tabs, so Arkib now takes the freed slot.
    expect(hrefsFor("guru_biasa")).toContain("/arkib");
  });
});

describe("navigation — the home matches the role", () => {
  it("puts the reviewer screens under Penyeliaan, not Pentadbiran", () => {
    const groups = navFor("gpk");
    const supervision = groups.find((g) => g.label === "Penyeliaan");

    expect(supervision?.items.map((i) => i.href)).toEqual(["/semakan", "/sekolah", "/laporan"]);
    expect(groups.some((g) => g.label === "Pentadbiran")).toBe(false);
  });

  it("gives the Administrator one home and no separate Urus eRPH item", () => {
    expect(hrefsFor("pentadbir")).toContain("/utama");
    expect(hrefsFor("pentadbir")).not.toContain("/pentadbiran");

    const admin = navFor("pentadbir").find((g) => g.label === "Pentadbiran");
    expect(admin?.items.map((i) => i.href)).toEqual(["/utama"]);
    expect(admin?.items[0]?.label).toBe("Papan Pemuka");
  });

  it("keeps reviewer and admin screens away from a Guru Biasa", () => {
    const hrefs = hrefsFor("guru_biasa");
    expect(hrefs).not.toContain("/semakan");
    expect(hrefs).not.toContain("/utama");
  });
});

describe("mobile navigation — four tabs, then Lagi", () => {
  it("keeps the reviewer's four main screens and puts Arkib and Templat behind Lagi", () => {
    const { primary, secondary } = mobileNavFor("gpk");

    expect(primary.map((item) => item.href)).toEqual([
      "/minggu",
      "/semakan",
      "/sekolah",
      "/laporan",
    ]);
    expect(secondary.flatMap((group) => group.items.map((item) => item.href))).toEqual([
      "/arkib",
      "/templat",
    ]);
  });

  it("shows a Guru Biasa every destination they have, with no empty Lagi tab", () => {
    const { primary, secondary } = mobileNavFor("guru_biasa");

    expect(primary.map((item) => item.href)).toEqual(["/minggu", "/arkib", "/templat"]);
    expect(secondary).toEqual([]);
  });

  it("gives the Administrator the console and the template library", () => {
    const { primary, secondary } = mobileNavFor("pentadbir");

    expect(primary.map((item) => item.href)).toEqual(["/utama", "/templat"]);
    expect(secondary).toEqual([]);
  });
});

describe("routeMetaFor — nested editor routes keep their name", () => {
  it("resolves an exact route", () => {
    expect(routeMetaFor("/minggu").title).toBe("Minggu Ini");
  });

  it("resolves /editor/<id> to the editor's title", () => {
    expect(routeMetaFor("/editor/01JABCDEF").title).toBe("Penyunting RPH");
    expect(routeMetaFor("/editor/01JABCDEF").crumb).toBe("Draf aktif");
  });

  it("uses a page-specific crumb rather than only school/session/week", () => {
    expect(routeMetaFor("/semakan").crumb).toBe("Giliran semakan");
    expect(routeMetaFor("/minggu").crumb).toBe("Ruang kerja");
  });

  it("tells the template authoring screen apart from the library it lives under", () => {
    // The penyunting is not a library screen, so it does not inherit the
    // library's crumb — a teacher should be able to tell which of the two
    // they are on from the title bar.
    expect(routeMetaFor("/templat/baru").crumb).toBe("Templat baharu");
    expect(routeMetaFor("/templat").crumb).toBe("Templat tersedia");
  });

  it("falls back for an unknown route", () => {
    expect(routeMetaFor("/tiada")).toEqual({ title: "eRPH", crumb: "" });
  });
});
