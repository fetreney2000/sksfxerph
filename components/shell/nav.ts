import {
  BookOpen,
  Clock3,
  FileText,
  History,
  LayoutGrid,
  type LucideIcon,
  PenLine,
  School,
  ScrollText,
  Settings2,
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
      },
      {
        href: "/editor",
        label: ms.nav.editor,
        short: "Tulis",
        icon: PenLine,
        perm: "rph",
        badge: "drafts",
      },
      {
        href: "/templat",
        label: ms.nav.templat,
        short: "Templat",
        icon: BookOpen,
        perm: "templat",
      },
      { href: "/arkib", label: ms.nav.arkib, short: "Arkib", icon: History, perm: "rph" },
    ],
  },
  {
    label: ms.nav.pentadbiran,
    items: [
      // The Administrator's home. Listed first because it *is* their landing
      // page — for every other role `navFor` filters it out and the group
      // still reads correctly.
      {
        href: "/utama",
        label: ms.nav.utama,
        short: "Utama",
        icon: LayoutGrid,
        perm: "pentadbir",
      },
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
        label: "Laporan & Eksport",
        short: "Laporan",
        icon: FileText,
        perm: "laporan",
      },
      {
        href: "/pentadbiran",
        label: ms.nav.urus,
        short: "Urus",
        icon: Settings2,
        perm: "pentadbir",
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

export const ROUTE_META: Record<string, { title: string; crumb: string }> = {
  "/minggu": { title: ms.nav.minggu, crumb: "Minggu ini" },
  "/editor": { title: ms.nav.editor, crumb: "Draf aktif" },
  "/templat": { title: ms.nav.templat, crumb: "Templat tersedia" },
  "/arkib": { title: ms.nav.arkib, crumb: "Rekod sesi" },
  "/utama": { title: ms.nav.utama, crumb: "Papan pemuka pentadbir" },
  "/semakan": { title: ms.nav.semakan, crumb: "Mod pentadbir" },
  "/sekolah": { title: ms.nav.sekolah, crumb: "Pemantauan sekolah" },
  "/laporan": { title: "Laporan & Eksport", crumb: "Eksport rasmi" },
  "/pentadbiran": { title: ms.nav.urus, crumb: "Pentadbiran" },
};

export { Clock3 };
