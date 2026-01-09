import { Bell, User, LogOut, Settings, Sparkles, ScanLine } from "lucide-react";
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

export function NavBar() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    navigate("/auth");
  };

  return (
    <nav className="h-14 sm:h-16 bg-card/80 glass border-b border-border/50 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-40 transition-fast" aria-label="Top navigation">
      {/* Mobile: logo (sidebar hidden) */}
      <div className="flex items-center gap-2.5 lg:hidden pl-10">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-glow">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <h1 className="text-base font-bold text-foreground">Card Scanner</h1>
      </div>

      {/* Desktop: breadcrumbs */}
      <div className="hidden lg:flex items-center gap-3 min-w-0">
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-2">
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

        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground transition-all relative"
          aria-label="View notifications"
        >
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground transition-all"
              aria-label="Open user menu"
            >
              <div className="h-8 w-8 rounded-full bg-secondary border border-border flex items-center justify-center">
                <User className="h-4 w-4" aria-hidden="true" />
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
