import { LayoutDashboard, ScanLine, FolderOpen, BookOpen, Settings, Lightbulb, Menu, Activity, Brain, Award, Search, DollarSign, Sparkles } from "lucide-react";
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
  { icon: Search, label: "Visual Search", path: "/visual-search" },
  { icon: DollarSign, label: "Price Hub", path: "/price-hub" },
  { icon: Brain, label: "Value Predictor", path: "/predictions" },
  { icon: Lightbulb, label: "AI Insights", path: "/insights" },
  { icon: Activity, label: "Performance", path: "/performance" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

export function SideBar() {
  const [open, setOpen] = useState(false);

  const handleNavClick = useCallback(() => {
    setOpen(false);
  }, []);

  const NavItems = () => (
    <div className="space-y-1">
      {menuItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={handleNavClick}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-200 active:scale-[0.98] group"
          activeClassName="bg-sidebar-accent text-primary font-medium shadow-sm"
          aria-label={`Navigate to ${item.label}`}
        >
          <item.icon className="h-[18px] w-[18px] flex-shrink-0 group-hover:text-primary transition-colors" aria-hidden="true" />
          <span className="truncate text-sm">{item.label}</span>
        </NavLink>
      ))}
    </div>
  );

  return (
    <>
      {/* Mobile Menu */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild className="lg:hidden fixed top-3 left-3 z-50">
          <Button 
            variant="outline" 
            size="icon-sm" 
            className="lg:hidden glass shadow-lg border-border/50 active:scale-95 transition-all"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent 
          side="left" 
          className="w-[280px] p-0 bg-sidebar border-sidebar-border safe-top safe-bottom"
          aria-label="Navigation menu"
        >
          {/* Logo */}
          <div className="p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-base font-bold text-foreground">Card Scanner</h1>
                <p className="text-2xs text-sidebar-foreground">Premium Edition</p>
              </div>
            </div>
          </div>
          <nav 
            className="flex flex-col gap-1 p-3 overflow-y-auto max-h-[calc(100vh-5rem)] touch-pan-y"
            aria-label="Main navigation"
            role="navigation"
          >
            <NavItems />
          </nav>
        </SheetContent>
      </Sheet>

      {/* Desktop Sidebar */}
      <aside 
        className="hidden lg:flex lg:flex-col w-60 bg-sidebar border-r border-sidebar-border min-h-screen sticky top-0 transition-gpu"
        aria-label="Sidebar navigation"
      >
        {/* Logo */}
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">Card Scanner</h1>
              <p className="text-2xs text-sidebar-foreground">Premium Edition</p>
            </div>
          </div>
        </div>
        <nav 
          className="flex-1 flex flex-col gap-1 p-3 overflow-y-auto"
          aria-label="Main navigation"
          role="navigation"
        >
          <NavItems />
        </nav>
        
        {/* Footer */}
        <div className="p-4 border-t border-sidebar-border">
          <p className="text-2xs text-sidebar-foreground/60 text-center">v2.0 Pro</p>
        </div>
      </aside>
    </>
  );
}
