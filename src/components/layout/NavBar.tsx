import { Bell, User, LogOut, Settings, Sparkles, ScanLine, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Breadcrumbs } from "./Breadcrumbs";
import { useTheme } from "next-themes";

export function NavBar() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    navigate("/auth");
  };

  return (
    <nav className="h-12 xs:h-14 sm:h-16 bg-card/80 glass border-b border-border/50 flex items-center justify-between px-2 xs:px-3 sm:px-4 md:px-6 sticky top-0 z-40 transition-fast shrink-0" aria-label="Top navigation">
      {/* Mobile: logo (sidebar hidden) */}
      <div className="flex items-center gap-1.5 xs:gap-2 lg:hidden pl-10 xs:pl-12 min-w-0 flex-1">
        <div className="h-6 w-6 xs:h-7 xs:w-7 sm:h-8 sm:w-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-glow shrink-0">
          <Sparkles className="h-3 w-3 xs:h-3.5 xs:w-3.5 sm:h-4 sm:w-4 text-primary-foreground" />
        </div>
        <h1 className="text-xs xs:text-sm sm:text-base font-bold text-foreground truncate">Card Scanner</h1>
      </div>

      {/* Desktop: breadcrumbs */}
      <div className="hidden lg:flex items-center gap-3 min-w-0 flex-1">
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-0.5 xs:gap-1 sm:gap-2 shrink-0">
        {/* Primary action */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate("/scan")}
          className="hidden sm:inline-flex"
          aria-label="Go to Scan"
        >
          <ScanLine className="mr-2 h-4 w-4" aria-hidden="true" />
          Scan
        </Button>
        
        {/* Mobile scan button */}
        <Button
          variant="secondary"
          size="icon"
          onClick={() => navigate("/scan")}
          className="sm:hidden h-7 w-7 xs:h-8 xs:w-8"
          aria-label="Go to Scan"
        >
          <ScanLine className="h-3.5 w-3.5 xs:h-4 xs:w-4" aria-hidden="true" />
        </Button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground transition-all h-7 w-7 xs:h-8 xs:w-8 sm:h-9 sm:w-9"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5 xs:h-4 xs:w-4" aria-hidden="true" />
          ) : (
            <Moon className="h-3.5 w-3.5 xs:h-4 xs:w-4" aria-hidden="true" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground transition-all relative h-7 w-7 xs:h-8 xs:w-8 sm:h-9 sm:w-9"
          aria-label="View notifications"
        >
          <Bell className="h-3.5 w-3.5 xs:h-4 xs:w-4" aria-hidden="true" />
          <span className="absolute top-1 right-1 xs:top-1.5 xs:right-1.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden="true" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground transition-all h-7 w-7 xs:h-8 xs:w-8 sm:h-9 sm:w-9 p-0"
              aria-label="Open user menu"
            >
              <div className="h-6 w-6 xs:h-7 xs:w-7 sm:h-8 sm:w-8 rounded-full bg-secondary border border-border flex items-center justify-center">
                <User className="h-3 w-3 xs:h-3.5 xs:w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 z-50 bg-popover border-border shadow-lg rounded-xl p-1">
            <DropdownMenuLabel className="text-muted-foreground font-normal px-3 py-2">
              <p className="text-sm font-medium text-foreground">My Account</p>
              <p className="text-xs text-muted-foreground">Manage your profile</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-border/60" />
            <DropdownMenuItem
              onClick={() => navigate("/settings")}
              className="cursor-pointer rounded-lg mx-1 px-3 py-2.5 focus:bg-secondary"
            >
              <Settings className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border/60" />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-destructive cursor-pointer rounded-lg mx-1 px-3 py-2.5 focus:bg-destructive/10"
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
