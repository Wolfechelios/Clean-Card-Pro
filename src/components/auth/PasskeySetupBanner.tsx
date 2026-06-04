import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Fingerprint, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  isPasskeySupported,
  hasPlatformAuthenticator,
  registerPasskey,
  markPasskeyRegistered,
} from "@/lib/passkey";

const DISMISS_KEY = "cleancards.passkey.dismissed";

export function PasskeySetupBanner() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      if (!isPasskeySupported()) return;
      if (!(await hasPlatformAuthenticator())) return;
      const dismissed = localStorage.getItem(`${DISMISS_KEY}.${user.id}`);
      if (dismissed) return;
      const { count } = await supabase
        .from("user_passkeys")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if ((count ?? 0) === 0) setShow(true);
    })();
  }, [user]);

  if (!user || !show) return null;

  const dismiss = () => {
    localStorage.setItem(`${DISMISS_KEY}.${user.id}`, "1");
    setShow(false);
  };

  const enroll = async () => {
    setLoading(true);
    try {
      await registerPasskey();
      markPasskeyRegistered(user.id);
      toast.success("Passkey saved on this device");
      setShow(false);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/cancel|abort|NotAllowed/i.test(msg)) {
        toast.error(msg || "Could not set up passkey");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2">
      <Card className="border-primary/40 bg-card shadow-elevated">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="rounded-full bg-primary/15 p-2">
            <Fingerprint className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Skip the password next time</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Use Face ID / fingerprint to sign in on this device.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={enroll} disabled={loading}>
                {loading ? "Setting up..." : "Set up passkey"}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Not now
              </Button>
            </div>
          </div>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
