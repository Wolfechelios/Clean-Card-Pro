import { LayoutDashboard, ScanLine, FolderOpen, BookOpen, Settings, Lightbulb, Menu, Eye, Activity, Layers, MapPin, Brain, Award } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: ScanLine, label: "Scan", path: "/scan" },
  { icon: Award, label: "Graded Cards", path: "/graded" },
  { icon: FolderOpen, label: "Collections", path: "/collections" },
  { icon: BookOpen, label: "Binders", path: "/binders" },
  { icon: Brain, label: "Value Predictor", path: "/predictions" },
  { icon: Lightbulb, label: "AI Insights", path: "/insights" },
  { icon: Activity, label: "Performance", path: "/performance" },
  { icon: Layers, label: "Architecture", path: "/architecture" },
  { icon: MapPin, label: "Roadmap", path: "/roadmap" },
  { icon: Eye, label: "Vision Test", path: "/vision-test" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

export function SideBar() {
  const [open, setOpen] = useState(false);

  const handleNavClick = useCallback(() => {
    setOpen(false);
  }, []);

  const NavItems = () => (
    <>
      {menuItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={handleNavClick}
          className="flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-fast active:scale-[0.98]"
          activeClassName="bg-accent text-accent-foreground font-medium"
          aria-label={`Navigate to ${item.label}`}
        >
          <item.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <span className="truncate text-sm sm:text-base">{item.label}</span>
        </NavLink>
      ))}
    </>
  );

  return (
    <>
      {/* Mobile Menu */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild className="lg:hidden fixed top-2 left-2 sm:top-3 sm:left-3 z-50">
          <Button 
            variant="outline" 
            size="icon" 
            className="lg:hidden h-10 w-10 bg-background/95 backdrop-blur-sm shadow-lg border-border active:scale-95 transition-fast"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent 
          side="left" 
          className="w-[280px] sm:w-64 p-0 bg-sidebar border-sidebar-border safe-top safe-bottom"
          aria-label="Navigation menu"
        >
          <nav 
            className="flex flex-col gap-1 p-3 sm:p-4 mt-12 overflow-y-auto max-h-[calc(100vh-4rem)] touch-pan-y"
            aria-label="Main navigation"
            role="navigation"
          >
            <NavItems />
          </nav>
        </SheetContent>
      </Sheet>

      {/* Desktop Sidebar */}
      <aside 
        className="hidden lg:block w-64 bg-sidebar border-r border-sidebar-border min-h-screen sticky top-0 transition-gpu"
        aria-label="Sidebar navigation"
      >
        <nav 
          className="flex flex-col gap-1 p-4 overflow-y-auto max-h-screen"
          aria-label="Main navigation"
          role="navigation"
        >
          <NavItems />
        </nav>
      </aside>
    </>
  );
}
