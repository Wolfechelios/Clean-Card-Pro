import {
  LayoutDashboard,
  ScanLine,
  FolderOpen,
  BookOpen,
  Award,
  Search,
  DollarSign,
  Brain,
  Megaphone,
  Lightbulb,
  Activity,
  Settings,
  HelpCircle,
  Wand2,
  Database,
  Wrench,
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
 * Single source of truth for navigation.
 * Keep this list small + task-oriented (collector workflow first).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Core",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", keywords: ["home"] },
      { icon: ScanLine, label: "Scan", path: "/scan", keywords: ["camera", "ocr", "rapid"] },
      { icon: FolderOpen, label: "Collections", path: "/collections", keywords: ["library", "cards"] },
      { icon: BookOpen, label: "Binder", path: "/binder", keywords: ["set", "completion", "slots"] },
    ],
  },
  {
    title: "Tools",
    items: [
      { icon: Award, label: "Graded", path: "/graded", keywords: ["psa", "bgs", "cgc"] },
      { icon: Search, label: "Visual Search", path: "/visual-search", keywords: ["image"] },
      { icon: DollarSign, label: "Price Hub", path: "/price-hub", keywords: ["prices", "alerts"] },
      { icon: Brain, label: "Predictor", path: "/predictions", keywords: ["forecast", "value"] },
      { icon: Wand2, label: "Deck Builder", path: "/deck-builder", keywords: ["ai", "value", "battle", "competitive"] },
      { icon: Megaphone, label: "Sell Assist", path: "/sell-assist", keywords: ["listing", "ebay", "tcgplayer", "whatnot", "market"] },
      { icon: Database, label: "Price DB", path: "/price-database", keywords: ["pricecharting", "import", "xlsx", "set", "completion"] },
      { icon: Wrench, label: "Bulk Tools", path: "/bulk-tools", keywords: ["bulk", "prices", "images", "rarity", "reid", "repair"] },
    ],
  },
  {
    title: "Insights",
    items: [
      { icon: Lightbulb, label: "AI Insights", path: "/insights", keywords: ["analysis"] },
      { icon: Activity, label: "Performance", path: "/performance", keywords: ["stats"] },
    ],
  },
  {
    title: "Settings",
    items: [
      { icon: Settings, label: "Settings", path: "/settings", keywords: ["account"] },
      { icon: HelpCircle, label: "Help", path: "/help", keywords: ["support", "faq"] },
    ],
  },
];

export const NAV_FLAT: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export function labelForPath(pathname: string) {
  const hit = NAV_FLAT.find((i) => i.path === pathname);
  return hit?.label ?? "";
}
