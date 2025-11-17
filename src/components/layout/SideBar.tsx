import { LayoutDashboard, ScanLine, FolderOpen, BookOpen, Settings, Lightbulb, Menu, Eye } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: ScanLine, label: "Scan", path: "/scan" },
  { icon: FolderOpen, label: "Collections", path: "/collections" },
  { icon: BookOpen, label: "Binders", path: "/binders" },
  { icon: Lightbulb, label: "AI Insights", path: "/insights" },
  { icon: Eye, label: "Vision Test", path: "/vision-test" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

export function SideBar() {
  const [open, setOpen] = useState(false);

  const NavItems = () => (
    <>
      {menuItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={() => setOpen(false)}
          className="flex items-center gap-3 px-4 py-3 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200 hover:translate-x-1"
          activeClassName="bg-accent text-accent-foreground font-medium"
        >
          <item.icon className="h-5 w-5" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </>
  );

  return (
    <>
      {/* Mobile Menu */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild className="lg:hidden fixed top-4 left-4 z-50">
          <Button variant="outline" size="icon" className="lg:hidden bg-background shadow-lg">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
          <nav className="flex flex-col gap-1 p-4 mt-8">
            <NavItems />
          </nav>
        </SheetContent>
      </Sheet>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 bg-sidebar border-r border-sidebar-border min-h-screen sticky top-0">
        <nav className="flex flex-col gap-1 p-4">
          <NavItems />
        </nav>
      </aside>
    </>
  );
}
