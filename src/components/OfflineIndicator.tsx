import { useEffect, useState } from "react";

export function OfflineIndicator() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 rounded-md border bg-card px-3 py-2 text-sm text-card-foreground shadow">
      Offline
    </div>
  );
}
