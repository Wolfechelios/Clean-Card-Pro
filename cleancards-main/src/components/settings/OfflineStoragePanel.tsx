import { useState, useEffect } from "react";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { clearAllCache, saveAllImagesToDevice } from "@/lib/offlineManager";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  RefreshCw,
  Trash2,
  HardDrive,
  Image,
  CloudOff,
  Cloud,
  Clock,
  AlertCircle,
  Download,
  ImageDown,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow } from "date-fns";

export function OfflineStoragePanel() {
  const { isOnline, isSyncing, stats, lastSync, sync, cleanup, refreshStats } = useOfflineSync();
  const [isClearing, setIsClearing] = useState(false);
  const [isSavingImages, setIsSavingImages] = useState(false);
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number } | null>(null);
  const [isFixingUrls, setIsFixingUrls] = useState(false);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const handleClearCache = async () => {
    setIsClearing(true);
    try {
      await clearAllCache();
      toast.success("All cached data cleared");
      await refreshStats();
    } catch (error) {
      toast.error("Failed to clear cache");
    } finally {
      setIsClearing(false);
    }
  };

  const [storageQuota, setStorageQuota] = useState<{ used: number; quota: number } | null>(null);

  useEffect(() => {
    if ("storage" in navigator && "estimate" in navigator.storage) {
      navigator.storage.estimate().then((estimate) => {
        setStorageQuota({
          used: estimate.usage || 0,
          quota: estimate.quota || 0,
        });
      });
    }
  }, [stats]);

  const usagePercent = storageQuota ? (storageQuota.used / storageQuota.quota) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              Offline Storage
            </CardTitle>
            <CardDescription>
              Manage cached data for offline access
            </CardDescription>
          </div>
          <Badge variant={isOnline ? "default" : "destructive"} className="gap-1">
            {isOnline ? (
              <><Cloud className="h-3 w-3" /> Online</>
            ) : (
              <><CloudOff className="h-3 w-3" /> Offline</>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {storageQuota && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Device Storage</span>
              <span>
                {formatBytes(storageQuota.used)} / {formatBytes(storageQuota.quota)}
              </span>
            </div>
            <Progress value={usagePercent} className="h-2" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <StatCard icon={<HardDrive className="h-4 w-4" />} label="Cached Cards" value={stats?.cardsCount ?? 0} />
          <StatCard icon={<Image className="h-4 w-4" />} label="Cached Images" value={stats?.imagesCount ?? 0} />
          <StatCard icon={<AlertCircle className="h-4 w-4" />} label="Pending Sync" value={stats?.pendingSyncCount ?? 0} highlight={stats?.pendingSyncCount ? stats.pendingSyncCount > 0 : false} />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Last Sync" value={lastSync ? formatDistanceToNow(lastSync, { addSuffix: true }) : "Never"} isText />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={sync} disabled={!isOnline || isSyncing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing..." : "Sync Now"}
          </Button>

          <Button
            variant="outline"
            onClick={async () => {
              if (!isOnline) { toast.error("Must be online"); return; }
              setIsSavingImages(true);
              setImageProgress(null);
              try {
                const result = await saveAllImagesToDevice(
                  "",
                  (done, total) => setImageProgress({ done, total }),
                );
                toast.success(`Saved ${result.saved} images to device${result.failed ? `, ${result.failed} failed` : ""}`);
                await refreshStats();
              } catch (e: any) {
                toast.error("Failed: " + e.message);
              } finally {
                setIsSavingImages(false);
                setImageProgress(null);
              }
            }}
            disabled={isSavingImages}
            className="gap-2"
          >
            <ImageDown className={`h-4 w-4 ${isSavingImages ? "animate-pulse" : ""}`} />
            {isSavingImages
              ? imageProgress ? `${imageProgress.done}/${imageProgress.total}` : "Saving..."
              : "Save All Images"}
          </Button>

          <Button
            variant="outline"
            onClick={async () => {
              if (!isOnline) { toast.error("Must be online"); return; }
              setIsFixingUrls(true);
              try {
                const { data, error } = await supabase.functions.invoke("fix-image-urls");
                if (error) throw error;
                toast.success(`Fixed ${data?.fixed ?? 0} expired image URLs`);
              } catch (e: any) {
                toast.error("Failed: " + e.message);
              } finally {
                setIsFixingUrls(false);
              }
            }}
            disabled={isFixingUrls}
            className="gap-2"
          >
            <Wrench className={`h-4 w-4 ${isFixingUrls ? "animate-spin" : ""}`} />
            {isFixingUrls ? "Fixing..." : "Fix Broken Images"}
          </Button>

          <Button variant="outline" onClick={cleanup} className="gap-2">
            <Download className="h-4 w-4" />
            Cleanup Old Data
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="gap-2" disabled={isClearing}>
                <Trash2 className="h-4 w-4" />
                Clear All
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all cached data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove all locally cached cards and images. Pending
                  changes that haven't synced will be lost. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearCache}>Clear Cache</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {isSavingImages && imageProgress && (
          <Progress value={(imageProgress.done / imageProgress.total) * 100} className="h-2" />
        )}

        <div className="rounded-lg bg-muted/50 p-4 space-y-2">
          <h4 className="font-medium text-sm">Offline Mode Features</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• View your card collection without internet</li>
            <li>• <strong>Save All Images</strong> downloads every card photo to device</li>
            <li>• <strong>Fix Broken Images</strong> repairs expired cloud URLs</li>
            <li>• Scan cards offline - they'll sync when connected</li>
            <li>• Changes auto-sync when back online</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ icon, label, value, highlight = false, isText = false }: {
  icon: React.ReactNode; label: string; value: number | string; highlight?: boolean; isText?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-warning bg-warning/10" : "bg-card"}`}>
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className={`font-semibold ${isText ? "text-sm" : "text-xl"}`}>{value}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
