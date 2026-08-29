import {
  LayoutDashboard,
  ScanLine,
  FolderOpen,
  BookOpen,
  Library,
  Settings,
  Database,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  keywords?: string[];
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

/**
 * Clean app navigation.
 * Keep only the workflows actually used: scan, save, review, price database, settings.
 * Heavy/experimental pages still exist in the repo but are no longer loaded in the main app shell.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Main",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", keywords: ["home"] },
      { icon: ScanLine, label: "Rapid Scan", path: "/scan", keywords: ["camera", "ocr", "rapid"] },
      { icon: FolderOpen, label: "Cards", path: "/collections", keywords: ["library", "collection"] },
      { icon: BookOpen, label: "Binder", path: "/binder", keywords: ["set", "completion", "slots"] },
      { icon: Library, label: "Comics", path: "/comics", keywords: ["comic", "issue", "cgc"] },
      { icon: Database, label: "Price DB", path: "/price-database", keywords: ["pricecharting", "prices", "set"] },
      { icon: Settings, label: "Settings", path: "/settings", keywords: ["account", "camera"] },
    ],
  },
];

export const NAV_FLAT: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export function labelForPath(pathname: string) {
  const hit = NAV_FLAT.find((i) => i.path === pathname);
  return hit?.label ?? "";
}
