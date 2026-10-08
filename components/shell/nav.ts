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
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: ms.nav.guru,
    items: [
      { href: "/minggu", label: ms.nav.minggu, icon: LayoutGrid, perm: "rph" },
      {
        href: "/editor",
        label: ms.nav.editor,
        icon: PenLine,
        perm: "rph",
        badge: "drafts",
      },
      { href: "/templat", label: ms.nav.templat, icon: BookOpen, perm: "rph" },
      { href: "/arkib", label: ms.nav.arkib, icon: History, perm: "rph" },
    ],
  },
  {
    label: ms.nav.pentadbiran,
    items: [
      {
        href: "/semakan",
        label: ms.nav.semakan,
        icon: ScrollText,
        perm: "semak",
        badge: "pending",
      },
      { href: "/sekolah", label: ms.nav.sekolah, icon: School, perm: "pantau" },
      { href: "/laporan", label: "Laporan & Eksport", icon: FileText, perm: "laporan" },
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
  "/semakan": { title: ms.nav.semakan, crumb: "Mod pentadbir" },
  "/sekolah": { title: ms.nav.sekolah, crumb: "Pemantauan sekolah" },
  "/laporan": { title: "Laporan & Eksport", crumb: "Eksport rasmi" },
};

export { Clock3 };
