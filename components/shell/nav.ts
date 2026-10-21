import {
  BookOpen,
  FileText,
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
   * Permission needed to see this entry. Read by `navFor()` — the sidebar,
   * the mobile bar and the command palette all go through it, so an item a
   * role cannot reach disappears everywhere at once instead of surviving in
   * one surface (the old `scope` field was declared and never read).
   */
  perm: Permission;
  /** Optional live badge source, resolved by the sidebar. */
  badge?: "drafts" | "pending";
  /**
   * Abbreviation for the bottom bar.
   *
   * Five destinations across 375px is ~75px each, and "Perpustakaan Templat"
   * measures 126px — so without this the label either truncates to something
   * unreadable or pushes the bar past the viewport, which is exactly what it
   * was doing. The sidebar keeps the full label; only the mobile bar uses this.
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
        href: "/sekolah",
        label: ms.nav.sekolah,
        short: "Sekolah",
        icon: School,
        perm: "pantau",
      },
      {
        href: "/laporan",
        label: "Laporan dan Eksport",
        short: "Laporan",
        icon: FileText,
        perm: "laporan",
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
  {
    // The template library is a resource for every role, not part of a
    // teacher's group — otherwise the Administrator's only "Guru" item was a
    // library they administer but do not use to plan.
    label: ms.nav.sumber,
    items: [
      {
        href: "/templat",
        label: ms.nav.templat,
        short: "Templat",
        icon: BookOpen,
        perm: "templat",
      },
    ],
  },
];

/** Navigation for a role — groups with nothing permitted in them disappear. */
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
 * The old bar named a hardcoded subset of six routes. It happened to include
 * Arkib but not Laporan, so a reviewer on a phone could not reach the export
 * screen at all. Keeping the order here means the bar and the sheet cannot
 * disagree about which destinations exist for a role.
 */
export const MOBILE_PRIMARY_ORDER: readonly string[] = [
  "/minggu",
  "/semakan",
  "/sekolah",
  "/laporan",
  "/utama",
  "/arkib",
  "/templat",
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
 * A role with four or fewer destinations has no sheet — a "Lagi" tab that opens
 * an empty drawer is worse than no tab at all. A reviewer gets their four main
 * screens (Minggu, Semakan, Sekolah, Laporan) and finds Arkib and Templat under
 * Lagi; a Guru Biasa sees all three of their destinations directly.
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
  "/templat": { title: ms.nav.templat, crumb: "Templat tersedia" },
  // The wizard is not a library screen, so it does not inherit the library's
  // crumb — a teacher authoring a plan should be able to tell from the title
  // bar which of the two screens they are on.
  "/templat/baru": { title: ms.nav.templat, crumb: "Templat baharu" },
  "/arkib": { title: ms.nav.arkib, crumb: "Rekod sesi" },
  "/utama": { title: ms.nav.utama, crumb: "Papan pemuka pentadbir" },
  "/semakan": { title: ms.nav.semakan, crumb: "Giliran semakan" },
  "/sekolah": { title: ms.nav.sekolah, crumb: "Pemantauan sekolah" },
  "/laporan": { title: "Laporan dan Eksport", crumb: "Eksport rasmi" },
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
