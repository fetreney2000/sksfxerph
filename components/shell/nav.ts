import {
  BookMarked,
  History,
  LayoutGrid,
  type LucideIcon,
  School,
  ScrollText,
} from "lucide-react";
import { can, type Permission } from "@/lib/auth/permissions";
import { ms } from "@/lib/i18n/ms";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Permission needed to see this entry. Read by `navFor()` - the sidebar and
   * the mobile bar go through it, so an item a role cannot reach disappears
   * everywhere at once instead of surviving in one surface.
   */
  perm: Permission;
  /** Optional live badge source, resolved by the sidebar. */
  badge?: "drafts" | "pending";
  /**
   * Abbreviation for the bottom bar.
   *
   * Short labels keep the mobile bar readable on narrow screens.
   */
  short?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: ms.nav.guru,
    items: [
      {
        href: "/minggu",
        label: ms.nav.minggu,
        short: "Minggu",
        icon: LayoutGrid,
        perm: "rph",
        // The week is the plan workspace: drafts live here as rows, so the
        // badge that used to sit on "Penyunting RPH" belongs on this entry.
        badge: "drafts",
      },
      { href: "/arkib", label: ms.nav.arkib, short: "Arkib", icon: History, perm: "rph" },
      // Drive links, not files: the RPT itself stays in the teacher's Drive
      // and only the link is stored, so a supervisor can open and check it.
      { href: "/rpt", label: ms.nav.rpt, short: "RPT", icon: BookMarked, perm: "rph" },
    ],
  },
  {
    // A GPK is a "Penolong Kanan Pentadbiran", so calling their supervision
    // screens "Pentadbiran" collided with the Administrator's office. The
    // reviewer group says what those screens do: supervise.
    label: ms.nav.penyeliaan,
    items: [
      {
        href: "/semakan",
        label: ms.nav.semakan,
        short: "Semak",
        icon: ScrollText,
        perm: "semak",
        badge: "pending",
      },
      {
        href: "/direktori-rph",
        label: "Direktori RPH",
        short: "RPH guru",
        icon: History,
        perm: "semak",
      },
      {
        href: "/direktori-rpt",
        label: "Direktori RPT",
        short: "RPT guru",
        icon: BookMarked,
        perm: "semak",
      },
      {
        href: "/sekolah",
        label: ms.nav.sekolah,
        short: "Sekolah",
        icon: School,
        perm: "pantau",
      },
    ],
  },
  {
    label: ms.nav.pentadbiran,
    items: [
      // One home now: the overview, set-up checklist and the account/class/
      // subject/school/session tabs all live on `/utama`. The old "Urus eRPH"
      // item is gone rather than duplicated.
      {
        href: "/utama",
        label: ms.nav.utama,
        short: "Papan",
        icon: LayoutGrid,
        perm: "pentadbir",
      },
    ],
  },
];

/** Navigation for a role - groups with nothing permitted in them disappear. */
export function navFor(role: string | null | undefined): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(role, item.perm)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Order of the bottom bar. The first four permitted destinations get a tab;
 * everything else is reachable from **Lagi**.
 *
 * Keeping the order here means the bar and the sheet cannot disagree about
 * which destinations exist for a role.
 */
export const MOBILE_PRIMARY_ORDER: readonly string[] = [
  "/minggu",
  "/semakan",
  "/sekolah",
  "/utama",
  "/arkib",
  "/rpt",
];

const MOBILE_PRIMARY_LIMIT = 4;

export interface MobileNav {
  /** Destinations with their own tab in the bottom bar. */
  primary: NavItem[];
  /** Everything left over, grouped exactly as the sidebar groups it. */
  secondary: NavGroup[];
}

/**
 * Split a role's navigation into bottom-bar tabs and the "Lagi" sheet.
 *
 * A role with four or fewer destinations has no sheet - a "Lagi" tab that opens
 * an empty drawer is worse than no tab at all.
 */
export function mobileNavFor(role: string | null | undefined): MobileNav {
  const rank = (href: string) => {
    const index = MOBILE_PRIMARY_ORDER.indexOf(href);
    return index === -1 ? MOBILE_PRIMARY_ORDER.length : index;
  };
  const groups = navFor(role);
  const ordered = groups
    .flatMap((group) => group.items)
    .sort((a, b) => rank(a.href) - rank(b.href));

  const primary = ordered.slice(0, MOBILE_PRIMARY_LIMIT);
  const primaryHrefs = new Set(primary.map((item) => item.href));
  const secondary = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !primaryHrefs.has(item.href)),
    }))
    .filter((group) => group.items.length > 0);

  return { primary, secondary };
}

export const ROUTE_META: Record<string, { title: string; crumb: string }> = {
  "/minggu": { title: ms.nav.minggu, crumb: "Ruang kerja" },
  "/editor": { title: ms.nav.editor, crumb: "Draf aktif" },
  "/rpt": { title: ms.nav.rpt, crumb: "Pautan Drive" },
  "/arkib": { title: ms.nav.arkib, crumb: "Rekod sesi" },
  "/utama": { title: ms.nav.utama, crumb: "Papan pemuka pentadbir" },
  "/semakan": { title: ms.nav.semakan, crumb: "Giliran semakan" },
  "/direktori-rph": { title: "Direktori RPH", crumb: "Penyeliaan" },
  "/direktori-rpt": { title: "Direktori RPT", crumb: "Penyeliaan" },
  "/sekolah": { title: ms.nav.sekolah, crumb: "Pemantauan sekolah" },
  "/pentadbiran": { title: ms.nav.urus, crumb: "Pentadbiran" },
};

/**
 * Title for the topbar, including nested routes.
 *
 * `/editor/<id>` is still the editor even though it is not a navigation
 * destination. An exact lookup missed it and fell back to "eRPH", so a teacher
 * opening an existing plan lost the screen's name while a blank `/editor` kept
 * it. Longest-prefix wins so a future `/editor/<id>/preview` resolves to
 * `/editor` rather than any shallower match.
 */
export function routeMetaFor(pathname: string): { title: string; crumb: string } {
  const exact = ROUTE_META[pathname];
  if (exact) return exact;

  const parent = Object.keys(ROUTE_META)
    .filter((route) => pathname.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0];

  return parent
    ? (ROUTE_META[parent] ?? { title: "eRPH", crumb: "" })
    : { title: "eRPH", crumb: "" };
}
