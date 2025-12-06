import { Bell, User, LogOut, CreditCard } from "lucide-react";
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

export function NavBar() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    navigate("/auth");
  };

  return (
    <nav className="h-12 sm:h-14 bg-card border-b border-border flex items-center justify-between px-3 sm:px-6 sticky top-0 z-40 transition-fast">
      <div className="flex items-center gap-2 sm:gap-3">
        <CreditCard className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
        <h1 className="text-base sm:text-lg font-bold text-foreground truncate">Card Scanner</h1>
      </div>
      
      <div className="flex items-center gap-1 sm:gap-2">
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-9 w-9 sm:h-10 sm:w-10 text-muted-foreground hover:text-foreground transition-fast active:scale-95"
          aria-label="View notifications"
        >
          <Bell className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
        </Button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 sm:h-10 sm:w-10 text-muted-foreground hover:text-foreground transition-fast active:scale-95"
              aria-label="Open user menu"
            >
              <User className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 z-50 bg-popover">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings")} className="cursor-pointer">
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
