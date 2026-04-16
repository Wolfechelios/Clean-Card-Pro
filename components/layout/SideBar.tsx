import {
  Menu,
  Sparkles,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_SECTIONS, type NavItem } from "@/lib/navigation";

const LS_KEY = "card_scout_sidebar_collapsed_v1";

function ItemIcon({ Icon }: { Icon: LucideIcon }) {
  return <Icon className="h-[18px] w-[18px] flex-shrink-0" aria-hidden="true" />;
}

function NavItemRow({
  item,
  onClick,
  collapsed,
}: {
  item: NavItem;
  onClick?: () => void;
  collapsed: boolean;
}) {
  const row = (
    <NavLink
      to={item.path}
      onClick={onClick}
      className={
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-200 active:scale-[0.98] group"
      }
      activeClassName="bg-sidebar-accent text-primary font-medium shadow-sm"
      aria-label={`Navigate to ${item.label}`}
    >
      <span className="group-hover:text-primary transition-colors">
        <ItemIcon Icon={item.icon} />
      </span>
      {!collapsed && <span className="truncate text-sm">{item.label}</span>}
    </NavLink>
  );

  if (!collapsed) return row;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" className="rounded-lg">
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

export function SideBar() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v === "1") setCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  const setCollapsedPersist = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(LS_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const handleNavClick = useCallback(() => {
    setOpen(false);
  }, []);

  const sections = useMemo(() => NAV_SECTIONS, []);

  const NavItems = ({ compact }: { compact: boolean }) => (
    <div className="space-y-4">
      {sections.map((section) => (
        <div key={section.title}>
          {!compact && (
            <div className="px-3 pb-1 text-2xs font-semibold tracking-wide text-sidebar-foreground/70">
              {section.title}
            </div>
          )}
          <div className="space-y-1">
            {section.items.map((item) => (
              <NavItemRow
                key={item.path}
                item={item}
                onClick={handleNavClick}
                collapsed={compact}
              />
            ))}
          </div>
        </div>
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
          className="w-[296px] p-0 bg-sidebar border-sidebar-border safe-top safe-bottom"
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
            className="flex flex-col gap-3 p-3 overflow-y-auto max-h-[calc(100vh-5rem)] touch-pan-y"
            aria-label="Main navigation"
            role="navigation"
          >
            <NavItems compact={false} />
          </nav>
        </SheetContent>
      </Sheet>

      {/* Desktop Sidebar */}
      <aside
        className={
          "hidden lg:flex lg:flex-col bg-sidebar border-r border-sidebar-border min-h-screen sticky top-0 transition-all duration-200 " +
          (collapsed ? "w-[72px]" : "w-60")
        }
        aria-label="Sidebar navigation"
      >
        {/* Logo */}
        <div className="p-4 border-b border-sidebar-border">
          <div className={"flex items-center gap-2.5 " + (collapsed ? "justify-center" : "")}>
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            {!collapsed && (
              <div>
                <h1 className="text-base font-bold text-foreground">Card Scanner</h1>
                <p className="text-2xs text-sidebar-foreground">Premium Edition</p>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-3 p-3 overflow-y-auto" aria-label="Main navigation" role="navigation">
          <NavItems compact={collapsed} />
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-sidebar-border flex items-center justify-between">
          {!collapsed && <p className="text-2xs text-sidebar-foreground/60">v2.0 Pro</p>}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCollapsedPersist(!collapsed)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="rounded-lg">
              {collapsed ? "Expand" : "Collapse"}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </>
  );
}
