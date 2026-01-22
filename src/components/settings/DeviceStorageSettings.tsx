import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { HardDrive, Trash2, FolderOpen, Loader2, Smartphone } from "lucide-react";
import { useNativeStorage } from "@/hooks/use-native-storage";
import { isNativePlatform, isAndroid, isIOS } from "@/lib/platform";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function DeviceStorageSettings() {
  const { isNative, listImages, clearCache, getStorageStats } = useNativeStorage();
  const [stats, setStats] = useState<{ files: number; estimatedSize: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const loadStats = async () => {
    if (!isNative) return;
    setIsLoading(true);
    try {
      const storageStats = await getStorageStats();
      setStats(storageStats);
    } catch (error) {
      console.error("Failed to load storage stats:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, [isNative]);

  const handleClearCache = async () => {
    try {
      const success = await clearCache();
      if (success) {
        toast.success("Device cache cleared successfully");
        loadStats();
      } else {
        toast.error("Failed to clear cache");
      }
    } catch (error) {
      toast.error("Failed to clear cache");
    } finally {
      setShowClearDialog(false);
    }
  };

  // Only show on native platforms
  if (!isNativePlatform()) {
    return null;
  }

  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Device Storage
          </CardTitle>
          <CardDescription>
            Manage local storage on your {isAndroid() ? 'Android' : isIOS() ? 'iOS' : 'mobile'} device
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <Smartphone className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">Cached Card Scans</p>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : stats ? (
                  <p className="text-sm text-muted-foreground">
                    {stats.files} files • {stats.estimatedSize}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No cached data</p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadStats}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderOpen className="h-4 w-4" />
              )}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Clear cached card scan images to free up device storage.
              Uploaded cards remain safe in the cloud.
            </p>
            <Button
              variant="outline"
              onClick={() => setShowClearDialog(true)}
              disabled={!stats || stats.files === 0}
              className="w-fit"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Local Cache
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Device Cache?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all locally cached card scan images from your device.
              Your uploaded cards in the cloud will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearCache}>
              Clear Cache
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
