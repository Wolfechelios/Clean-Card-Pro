import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function PwaUpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const handler = () => setReady(true);
    window.addEventListener("pwa-update-available", handler as EventListener);
    return () => window.removeEventListener("pwa-update-available", handler as EventListener);
  }, []);

  if (!ready) return null;

  return (
    <div className="fixed left-3 right-3 bottom-3 z-[9999] rounded-xl border bg-background/95 backdrop-blur p-3 shadow-lg flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">Update available</div>
        <div className="text-xs text-muted-foreground truncate">Reload to install the latest version.</div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setReady(false)}>
          Later
        </Button>
        <Button size="sm" onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Reload
        </Button>
      </div>
    </div>
  );
}
