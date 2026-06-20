import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getNetworkStatus,
  onNetworkChange,
  getOfflineStats,
  syncFromServer,
  processPendingSync,
  cleanupOldCache,
  preloadCardImages,
  getAllCachedCards,
  OfflineStats,
} from "@/lib/offlineManager";
import { toast } from "sonner";

export function useOfflineSync() {
  const { userId } = useAuth();
  const [isOnline, setIsOnline] = useState(getNetworkStatus());
  const [isSyncing, setIsSyncing] = useState(false);
  const [stats, setStats] = useState<OfflineStats | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // Listen for network changes
  useEffect(() => {
    const unsubscribe = onNetworkChange((online) => {
      setIsOnline(online);
      if (online) {
        toast.success("Back online - syncing...");
        handleSync();
      } else {
        toast.warning("You're offline - changes will sync when reconnected");
      }
    });

    return unsubscribe;
  }, [userId]);

  // Load stats on mount
  useEffect(() => {
    refreshStats();
  }, []);

  const refreshStats = useCallback(async () => {
    const s = await getOfflineStats();
    setStats(s);
    if (s.lastSyncAt) {
      setLastSync(new Date(s.lastSyncAt));
    }
  }, []);

  const handleSync = useCallback(async () => {
    if (!userId || !isOnline || isSyncing) return;

    setIsSyncing(true);
    try {
      // First process pending changes
      const { success, failed } = await processPendingSync();
      if (success > 0) {
        toast.success(`Synced ${success} pending change${success > 1 ? "s" : ""}`);
      }
      if (failed > 0) {
        toast.error(`Failed to sync ${failed} change${failed > 1 ? "s" : ""}`);
      }

      // Then pull latest from server
      const count = await syncFromServer(userId);
      toast.success(`Loaded ${count} cards for offline use`);

      // Preload images in background
      const cards = await getAllCachedCards();
      preloadCardImages(cards.slice(0, 50)).catch(console.error);

      await refreshStats();
    } catch (error: any) {
      console.error("Sync error:", error);
      toast.error("Sync failed: " + error.message);
    } finally {
      setIsSyncing(false);
    }
  }, [userId, isOnline, isSyncing, refreshStats]);

  const handleCleanup = useCallback(async () => {
    const removed = await cleanupOldCache(30);
    if (removed > 0) {
      toast.success(`Cleaned up ${removed} old cached items`);
    }
    await refreshStats();
  }, [refreshStats]);

  return {
    isOnline,
    isSyncing,
    stats,
    lastSync,
    sync: handleSync,
    cleanup: handleCleanup,
    refreshStats,
  };
}
