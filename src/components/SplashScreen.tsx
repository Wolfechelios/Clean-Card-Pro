import { useEffect } from "react";

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onComplete, 650);
    return () => window.clearTimeout(t);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="text-xl font-semibold">Loading…</div>
        <div className="mt-1 text-sm text-muted-foreground">Preparing scanner</div>
      </div>
    </div>
  );
}
