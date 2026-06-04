import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Fingerprint } from "lucide-react";
import { toast } from "sonner";
import { isPasskeySupported, signInWithPasskey, hasLocalPasskeyHint } from "@/lib/passkey";

interface Props {
  email?: string;
  onSuccess?: () => void;
  variant?: "primary" | "ghost";
}

export function PasskeyButton({ email, onSuccess, variant = "primary" }: Props) {
  const [supported, setSupported] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSupported(isPasskeySupported());
  }, []);

  if (!supported) return null;

  const handle = async () => {
    setLoading(true);
    try {
      await signInWithPasskey(email);
      toast.success("Signed in");
      onSuccess?.();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/cancel|abort|NotAllowed/i.test(msg)) {
        toast.error(msg || "Passkey sign-in failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const hint = hasLocalPasskeyHint();

  return (
    <Button
      type="button"
      onClick={handle}
      disabled={loading}
      variant={variant === "primary" ? "default" : "outline"}
      className="w-full gap-2"
    >
      <Fingerprint className="h-4 w-4" />
      {loading ? "Verifying..." : hint ? "Sign in with passkey" : "Use a passkey"}
    </Button>
  );
}
