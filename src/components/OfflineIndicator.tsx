import { useState, useEffect } from "react";
import { WifiOff, Wifi, RefreshCw, Cloud, CloudOff } from "lucide-react";
import { getNetworkStatus, onNetworkChange } from "@/lib/offlineManager";
import { cn } from "@/lib/utils";

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(getNetworkStatus());
  const [showToast, setShowToast] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = onNetworkChange((online) => {
      setIsOnline(online);
      setShowToast(true);

      if (!online) {
        setWasOffline(true);
      }

      // Hide toast after 3 seconds
      setTimeout(() => setShowToast(false), 3000);
    });

    return unsubscribe;
  }, []);

  // Don't show anything if always online
  if (isOnline && !showToast && !wasOffline) return null;

  return (
    <>
      {/* Fixed indicator in corner */}
      <div
        className={cn(
          "fixed bottom-20 left-4 z-50 flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium shadow-lg transition-all duration-300",
          isOnline
            ? "bg-success/20 text-success border border-success/30"
            : "bg-destructive/20 text-destructive border border-destructive/30"
        )}
      >
        {isOnline ? (
          <>
            <Wifi className="h-4 w-4" />
            <span>Online</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span>Offline</span>
          </>
        )}
      </div>

      {/* Toast notification */}
      {showToast && (
        <div
          className={cn(
            "fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl transition-all duration-300 animate-fade-in",
            isOnline
              ? "bg-success text-success-foreground"
              : "bg-destructive text-destructive-foreground"
          )}
        >
          {isOnline ? (
            <>
              <Cloud className="h-5 w-5" />
              <div>
                <p className="font-semibold">Back Online</p>
                <p className="text-xs opacity-80">Syncing your changes...</p>
              </div>
              <RefreshCw className="h-4 w-4 animate-spin ml-2" />
            </>
          ) : (
            <>
              <CloudOff className="h-5 w-5" />
              <div>
                <p className="font-semibold">You're Offline</p>
                <p className="text-xs opacity-80">Changes saved locally</p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
