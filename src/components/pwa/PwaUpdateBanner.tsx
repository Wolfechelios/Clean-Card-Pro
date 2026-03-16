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

  const handleUpdate = async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.waiting) {
      // Tell the waiting SW to activate immediately
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      // The controllerchange listener in pwa.ts will reload the page
    } else {
      // Fallback: just reload
      window.location.reload();
    }
  };

  if (!ready) return null;

  return (
    <div className="fixed left-3 right-3 bottom-3 z-[9999] rounded-xl border bg-background/95 backdrop-blur p-3 shadow-lg flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">Update available</div>
        <div className="text-xs text-muted-foreground truncate">Tap to install the latest version.</div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setReady(false)}>
          Later
        </Button>
        <Button size="sm" onClick={handleUpdate}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Update
        </Button>
      </div>
    </div>
  );
}
