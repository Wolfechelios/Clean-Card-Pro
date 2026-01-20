import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogIn, AlertTriangle } from "lucide-react";

interface SessionExpiredDialogProps {
  open: boolean;
  email?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function SessionExpiredDialog({
  open,
  email: savedEmail,
  onClose,
  onSuccess,
}: SessionExpiredDialogProps) {
  const navigate = useNavigate();
  const [email, setEmail] = useState(savedEmail || "");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      toast.success("Signed back in!");
      setPassword("");
      onSuccess();
    } catch (error: any) {
      toast.error(error.message || "Sign in failed");
    } finally {
      setIsLoading(false);
    }
  };

  const goToFullAuth = () => {
    onClose();
    navigate("/auth");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle>Session Expired</DialogTitle>
              <DialogDescription>
                Your login session has expired. Please sign in again.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSignIn} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="reauth-email">Email</Label>
            <Input
              id="reauth-email"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reauth-password">Password</Label>
            <Input
              id="reauth-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <Button type="submit" disabled={isLoading} className="w-full">
              <LogIn className="mr-2 h-4 w-4" />
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={goToFullAuth}
              className="w-full text-muted-foreground"
            >
              Go to full sign-in page
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
