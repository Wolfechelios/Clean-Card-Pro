import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { syncFromServer, processPendingSync, preloadCardImages, getAllCachedCards, getNetworkStatus } from "@/lib/offlineManager";

/**
 * Hook to auto-sync cards when app loads and user is authenticated
 * This ensures offline data is fresh
 */
export function useAutoSync() {
  const { userId } = useAuth();

  useEffect(() => {
    if (!userId) return;

    const performSync = async () => {
      // Only sync if online
      if (!getNetworkStatus()) return;

      try {
        // Process any pending changes first
        await processPendingSync();

        // Check if we need a fresh sync (e.g., first load or stale data)
        const lastSync = localStorage.getItem("cleancards_last_sync");
        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;

        if (!lastSync || now - parseInt(lastSync) > ONE_HOUR) {
          console.log("[AutoSync] Syncing from server...");
          await syncFromServer(userId);
          localStorage.setItem("cleancards_last_sync", now.toString());

          // Preload top 10000 card images in background
          const cards = await getAllCachedCards();
          preloadCardImages(cards.slice(0, 10000)).catch(console.error);
        }
      } catch (error) {
        console.error("[AutoSync] Error:", error);
      }
    };

    // Delay sync to not block initial render
    const timer = setTimeout(performSync, 2000);
    return () => clearTimeout(timer);
  }, [userId]);
}
