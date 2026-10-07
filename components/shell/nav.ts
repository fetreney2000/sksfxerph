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
import { ms } from "@/lib/i18n/ms";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** `teacher` = everyone; `admin` = reviewers only. */
  scope: "teacher" | "admin";
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
      { href: "/minggu", label: ms.nav.minggu, icon: LayoutGrid, scope: "teacher" },
      {
        href: "/editor",
        label: ms.nav.editor,
        icon: PenLine,
        scope: "teacher",
        badge: "drafts",
      },
      { href: "/templat", label: ms.nav.templat, icon: BookOpen, scope: "teacher" },
      { href: "/arkib", label: ms.nav.arkib, icon: History, scope: "teacher" },
    ],
  },
  {
    label: ms.nav.pentadbiran,
    items: [
      {
        href: "/semakan",
        label: ms.nav.semakan,
        icon: ScrollText,
        scope: "admin",
        badge: "pending",
      },
      { href: "/sekolah", label: ms.nav.sekolah, icon: School, scope: "admin" },
      { href: "/laporan", label: "Laporan & Eksport", icon: FileText, scope: "admin" },
    ],
  },
];

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
