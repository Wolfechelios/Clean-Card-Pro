import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Floating hard-reload button for the preview iframe.
 *
 * - Only renders in dev or when running inside a Lovable preview iframe.
 * - Bumps a `?_r=<timestamp>` cache-busting query param.
 * - Clears Cache Storage + unregisters service workers before reloading
 *   so a stale SW or HMR drop can't keep serving a blank page.
 */
function isPreviewContext(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const inIframe = window.self !== window.top;
    const host = window.location.hostname;
    const isPreviewHost =
      host.includes("lovableproject.com") ||
      host.includes("lovable.app") ||
      host.startsWith("id-preview--") ||
      host === "localhost" ||
      host === "127.0.0.1";
    return inIframe || isPreviewHost || import.meta.env.DEV;
  } catch {
    return true; // cross-origin access blocked → almost certainly an iframe
  }
}

export function PreviewReloadButton() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShow(isPreviewContext());
  }, []);

  if (!show) return null;

  const handleHardReload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 1. Unregister all service workers
      if ("serviceWorker" in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
        } catch {
          /* ignore */
        }
      }
      // 2. Delete all caches
      if ("caches" in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
        } catch {
          /* ignore */
        }
      }
    } finally {
      // 3. Bump cache-busting param and reload
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("_r", Date.now().toString());
        window.location.replace(url.toString());
      } catch {
        window.location.reload();
      }
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9998] pointer-events-none">
      <Button
        type="button"
        size="icon"
        variant="secondary"
        onClick={handleHardReload}
        disabled={busy}
        aria-label="Hard reload preview"
        title="Hard reload preview (clears caches)"
        className="pointer-events-auto h-10 w-10 rounded-full shadow-lg border border-border/60 bg-card/90 backdrop-blur hover:bg-card"
      >
        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
      </Button>
    </div>
  );
}

export default PreviewReloadButton;
