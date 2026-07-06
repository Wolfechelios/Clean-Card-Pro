import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Cloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { syncFromSupabase, getAllCards } from "@/lib/localCards";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";

export function RestoreFromCloud() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [localCount, setLocalCount] = useState<number | null>(null);

  const refreshCount = async () => {
    const all = await getAllCards();
    setLocalCount(all.length);
  };

  const handleRestore = async (replace: boolean) => {
    if (!user) {
      toast.error("Sign in to restore cards from the cloud.");
      return;
    }
    setBusy(true);
    try {
      const rows = await syncFromSupabase({ replace });
      toast.success(`Restored ${rows.length} cards from cloud`);
      await qc.invalidateQueries();
      await refreshCount();
    } catch (e: any) {
      toast.error(e?.message ?? "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Cloud className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Restore from Cloud</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Pull your cards from the cloud database into this device's local storage.
        Use this on a new device or after clearing browser data.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => handleRestore(false)} disabled={busy || !user}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Cloud className="h-4 w-4 mr-2" />}
          Merge from Cloud
        </Button>
        <Button variant="outline" onClick={() => handleRestore(true)} disabled={busy || !user}>
          Replace Local with Cloud
        </Button>
        <Button variant="ghost" onClick={refreshCount} disabled={busy}>
          Check local count{localCount !== null ? `: ${localCount}` : ""}
        </Button>
      </div>
      {!user && (
        <p className="text-xs text-muted-foreground">Sign in required.</p>
      )}
    </Card>
  );
}

export default RestoreFromCloud;
