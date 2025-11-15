import { LayoutDashboard, ScanLine, FolderOpen, BookOpen, CreditCard, Settings } from "lucide-react";
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
    <div className="w-64 bg-neutral-950 border-r border-neutral-800 min-h-[calc(100vh-3.5rem)]">
      <nav className="flex flex-col gap-1 p-4">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-neutral-400 hover:bg-neutral-900 hover:text-white transition-colors"
            activeClassName="bg-neutral-900 text-white"
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
