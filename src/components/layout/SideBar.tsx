import { LayoutDashboard, ScanLine, FolderOpen, BookOpen, Settings } from "lucide-react";
import { NavLink } from "@/components/NavLink";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: ScanLine, label: "Scan", path: "/scan" },
  { icon: FolderOpen, label: "Collections", path: "/collections" },
  { icon: BookOpen, label: "Binders", path: "/binders" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

export function SideBar() {
  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border min-h-[calc(100vh-3.5rem)]">
      <nav className="flex flex-col gap-1 p-4">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            activeClassName="bg-accent text-accent-foreground font-medium"
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
