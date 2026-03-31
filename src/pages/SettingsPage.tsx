import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
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
import { LogOut, Trash2, User, Lock, ImageOff, Clock, RefreshCw, Database, ScanLine, ImageIcon, Wand2, Cpu, Key, Monitor, Search, Zap } from "lucide-react";
import { useDisplayScale } from "@/hooks/use-display-scale";

import ServiceImportExport from "@/components/settings/ServiceImportExport";
import DeviceStorageSettings from "@/components/settings/DeviceStorageSettings";
import { OfflineStoragePanel } from "@/components/settings/OfflineStoragePanel";
import { BulkRarityReanalyze } from "@/components/collections/BulkRarityReanalyze";
import { CardsNeedingReview } from "@/components/collections/CardsNeedingReview";
import { BulkImageLookup } from "@/components/collections/BulkImageLookup";
import { BulkCardReidentify } from "@/components/settings/BulkCardReidentify";
import { BulkPSA10Update } from "@/components/pricing/BulkPSA10Update";
import { BulkPriceRefresh } from "@/components/pricing/BulkPriceRefresh";
import { QueueStressTest } from "@/components/settings/QueueStressTest";
import { UserApiKeysManager } from "@/components/settings/UserApiKeysManager";
import { SettingsSkeleton } from "@/components/ui/loading-skeletons";
import { useScannerSettings } from "@/hooks/use-scanner-settings";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export default function Settings() {
  const navigate = useNavigate();
  const { user, userId, signOut } = useAuth();
  const { settings: scannerSettings, updateSettings: updateScannerSettings } = useScannerSettings();
  const { scale, setScale, scaleOptions } = useDisplayScale();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showDeleteNoImage, setShowDeleteNoImage] = useState(false);
  const [noImageCount, setNoImageCount] = useState(0);
  const [showDeleteRecent, setShowDeleteRecent] = useState(false);
  const [recentImportCount, setRecentImportCount] = useState(0);
  const [recentTimeRange, setRecentTimeRange] = useState(2); // hours
  const [showClearAll, setShowClearAll] = useState(false);
  const [totalCards, setTotalCards] = useState(0);
  const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
  const [showDeleteUnknown, setShowDeleteUnknown] = useState(false);
  const [unknownCardCount, setUnknownCardCount] = useState(0);
  const [nullRarityCount, setNullRarityCount] = useState(0);
  const [showStressTest, setShowStressTest] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredServer, setDiscoveredServer] = useState<{ url: string; type: string; gpu?: any } | null>(null);

  useEffect(() => {
    loadUserData();
    loadCollectionStats();
  }, []);

  const loadUserData = async () => {
    if (!userId) {
      setIsLoading(false);
      return;
    }
    
    try {
      setEmail(user?.email || "");

      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();

      if (profile) {
        setUsername(profile.username || "");
      }
    } catch (error) {
      console.error("Error loading user data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!userId) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ username })
        .eq("id", userId);

      if (error) throw error;

      toast.success("Profile updated successfully");
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      toast.success("Password updated successfully");
      setShowPasswordDialog(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("Error updating password:", error);
      toast.error("Failed to update password");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/auth");
      toast.success("Signed out successfully");
    } catch (error) {
      console.error("Error signing out:", error);
      toast.error("Failed to sign out");
    }
  };


  const loadCollectionStats = async () => {
    if (!userId) return;
    
    try {
      // Get total cards count
      const { count: total } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId);
      
      setTotalCards(total || 0);

      // Get no-image cards count
      const { count: noImage } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId)
        .or("image_url.is.null,image_url.eq.");
      
      setNoImageCount(noImage || 0);

      // Get recent imports count
      const cutoff = new Date(Date.now() - recentTimeRange * 60 * 60 * 1000).toISOString();
      const { count: recent } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId)
        .gte("created_at", cutoff);
      
      setRecentImportCount(recent || 0);

      // Get unknown cards count
      const { count: unknown } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId)
        .eq("card_name", "Unknown Card");
      
      setUnknownCardCount(unknown || 0);

      // Get missing rarity cards count (null / empty / Unknown)
const { count: missingRarity } = await supabase
  .from("cards")
  .select("*", { count: "exact", head: true })
  .eq("user_id", userId)
  .or("rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown");

setNullRarityCount(missingRarity || 0);
    } catch (error) {
      console.error("Error loading collection stats:", error);
    }
  };

  const handleDeleteNoImage = async () => {
    if (!userId) return;
    
    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", userId)
        .or("image_url.is.null,image_url.eq.");

      if (error) throw error;

      toast.success(`Deleted ${noImageCount} card(s) without images`);
      loadCollectionStats();
    } catch (error) {
      console.error("Error deleting no-image cards:", error);
      toast.error("Failed to delete no-image cards");
    } finally {
      setShowDeleteNoImage(false);
    }
  };

  const handleDeleteRecent = async () => {
    if (!userId) return;
    
    try {
      const cutoff = new Date(Date.now() - recentTimeRange * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", userId)
        .gte("created_at", cutoff);

      if (error) throw error;

      toast.success(`Deleted ${recentImportCount} recently imported card(s)`);
      loadCollectionStats();
    } catch (error) {
      console.error("Error deleting recent imports:", error);
      toast.error("Failed to delete recent imports");
    } finally {
      setShowDeleteRecent(false);
    }
  };

  const handleClearAll = async () => {
    if (!userId) return;
    
    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", userId);

      if (error) throw error;

      toast.success("All cards deleted successfully");
      loadCollectionStats();
    } catch (error) {
      console.error("Error clearing collection:", error);
      toast.error("Failed to clear collection");
    } finally {
      setShowClearAll(false);
    }
  };

  const handleDeleteUnknown = async () => {
    if (!userId) return;
    
    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", userId)
        .eq("card_name", "Unknown Card");

      if (error) throw error;

      toast.success(`Deleted ${unknownCardCount} unknown card(s)`);
      loadCollectionStats();
    } catch (error) {
      console.error("Error deleting unknown cards:", error);
      toast.error("Failed to delete unknown cards");
    } finally {
      setShowDeleteUnknown(false);
    }
  };

  const handleUpdatePrices = async () => {
    if (!userId) {
      toast.error("You must be logged in to update prices");
      return;
    }
    
    try {
      setIsUpdatingPrices(true);
      toast.loading("Updating prices...", { id: "price-update" });

      const { data, error } = await supabase.functions.invoke("update-prices", {
        body: { user_id: userId },
      });

      if (error) throw error;

      toast.success(
        `Price update complete! Updated ${data.updated} of ${data.total_checked} cards`,
        { id: "price-update" }
      );
      
      loadCollectionStats();
    } catch (error) {
      console.error("Error updating prices:", error);
      toast.error("Failed to update prices", { id: "price-update" });
    } finally {
      setIsUpdatingPrices(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!userId) return;
    
    try {
      // Call edge function to completely delete user account
      // This uses admin privileges to delete from auth.users,
      // which CASCADE deletes all related data
      const { error } = await supabase.functions.invoke("delete-user-account");
      
      if (error) throw error;
      
      // Sign out locally (session is already invalid on server)
      await signOut();
      
      navigate("/auth");
      toast.success("Account deleted successfully");
    } catch (error) {
      console.error("Error deleting account:", error);
      toast.error("Failed to delete account");
    }
  };

  if (isLoading) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      {/* Profile Settings */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Settings
          </CardTitle>
          <CardDescription>Update your profile information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              className="bg-background"
            />
          </div>

          <Button onClick={handleUpdateProfile} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Security */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Security
          </CardTitle>
          <CardDescription>Manage your account security</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setShowPasswordDialog(true)}>
            Change Password
          </Button>
        </CardContent>
      </Card>

      {/* Display Resolution / Scaling */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Display Resolution
          </CardTitle>
          <CardDescription>Adjust the UI scaling like a monitor resolution setting</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
            {scaleOptions.map((opt) => (
              <Button
                key={opt}
                size="sm"
                variant={scale === opt ? "default" : "outline"}
                className="text-xs"
                onClick={() => setScale(opt)}
              >
                {opt}%
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Current: <span className="font-medium text-foreground">{scale}%</span> — Lower values show more content (like a higher resolution monitor), higher values make everything larger.
          </p>
        </CardContent>
      </Card>

      {/* User API Keys */}
      <UserApiKeysManager />

      {/* Scanner Settings */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            Scanner Settings
          </CardTitle>
          <CardDescription>Configure card scanning behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-confirm-toggle" className="text-sm font-medium">
                Auto-Confirm Cards
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically save cards when confidence is high enough
              </p>
            </div>
            <Switch
              id="auto-confirm-toggle"
              checked={scannerSettings.autoConfirmEnabled}
              onCheckedChange={(checked) => updateScannerSettings({ autoConfirmEnabled: checked })}
            />
          </div>

          {scannerSettings.autoConfirmEnabled && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div>
                <Label htmlFor="auto-confirm-threshold" className="text-sm font-medium">
                  Confidence Threshold: {scannerSettings.autoConfirmThreshold}%
                </Label>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  Cards with confidence at or above this threshold will be automatically saved.
                </p>
                <Slider
                  id="auto-confirm-threshold"
                  min={50}
                  max={100}
                  step={5}
                  value={[scannerSettings.autoConfirmThreshold]}
                  onValueChange={(value) => updateScannerSettings({ autoConfirmThreshold: value[0] })}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>50% (More auto-saves)</span>
                  <span>100% (Only certain matches)</span>
                </div>
              </div>
            </div>
          )}

          <Separator />

          {/* Capture & UI */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Capture & UI</h3>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Haptic feedback on capture</Label>
                <p className="text-xs text-muted-foreground">Vibrate when a photo is taken</p>
              </div>
              <Switch
                checked={scannerSettings.hapticsOnCapture}
                onCheckedChange={(checked) => updateScannerSettings({ hapticsOnCapture: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Capture flash animation</Label>
                <p className="text-xs text-muted-foreground">Screen flash effect when capturing</p>
              </div>
              <Switch
                checked={scannerSettings.flashOnCapture}
                onCheckedChange={(checked) => updateScannerSettings({ flashOnCapture: checked })}
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-sm font-medium">Auto-timer interval</Label>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={scannerSettings.autoTimerIntervalSeconds}
                onChange={(e) => updateScannerSettings({ autoTimerIntervalSeconds: Number(e.target.value) as any })}
              >
                <option value={1}>1 second</option>
                <option value={1.5}>1.5 seconds</option>
                <option value={2}>2 seconds</option>
                <option value={5}>5 seconds</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Voice-activated capture</Label>
                <p className="text-xs text-muted-foreground">Say “snap” to take a photo (browser support varies)</p>
              </div>
              <Switch
                checked={scannerSettings.voiceCaptureEnabled}
                onCheckedChange={(checked) => updateScannerSettings({ voiceCaptureEnabled: checked })}
              />
            </div>

            {scannerSettings.voiceCaptureEnabled && (
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Voice keyword</Label>
                <Input
                  value={scannerSettings.voiceCaptureKeyword}
                  onChange={(e) => updateScannerSettings({ voiceCaptureKeyword: e.target.value })}
                  placeholder="snap"
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Manual focus lock toggle</Label>
                <p className="text-xs text-muted-foreground">Best-effort; some devices ignore this</p>
              </div>
              <Switch
                checked={scannerSettings.manualFocusLock}
                onCheckedChange={(checked) => updateScannerSettings({ manualFocusLock: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Fullscreen scan mode</Label>
                <p className="text-xs text-muted-foreground">Hide most UI while scanning</p>
              </div>
              <Switch
                checked={scannerSettings.fullscreenScanMode}
                onCheckedChange={(checked) => updateScannerSettings({ fullscreenScanMode: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Smart auto zoom-out</Label>
                <p className="text-xs text-muted-foreground">Automatically zooms out when cards get too close (for stacking)</p>
              </div>
              <Switch
                checked={scannerSettings.autoZoomEnabled}
                onCheckedChange={(checked) => updateScannerSettings({ autoZoomEnabled: checked })}
              />
            </div>


            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Auto-capture when stable</Label>
                <p className="text-xs text-muted-foreground">Hands-free: captures when the camera view becomes stable after motion</p>
              </div>
              <Switch
                checked={scannerSettings.autoCaptureEnabled}
                onCheckedChange={(checked) => updateScannerSettings({ autoCaptureEnabled: checked })}
              />
            </div>

            <Separator />

            {/* Batch Processing */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Batch Processing</h3>
              <div>
                <Label htmlFor="batch-scan-size" className="text-sm font-medium">
                  Concurrent Scan Workers: {scannerSettings.batchScanSize}
                </Label>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  Number of cards to process simultaneously (max 3 for stability).
                </p>
                <Slider
                  id="batch-scan-size"
                  min={1}
                  max={3}
                  step={1}
                  value={[Math.min(scannerSettings.batchScanSize, 3)]}
                  onValueChange={(value) => updateScannerSettings({ batchScanSize: value[0] })}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>1 (Sequential)</span>
                  <span>3 (Max parallel)</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Local Accelerator (Mac/PC) */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Local Accelerator (Mac/PC/Jetson)
              </h3>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Enable Local Accelerator</Label>
                  <p className="text-xs text-muted-foreground">
                    Offload OCR/identify/pricing to a Mac/PC or Jetson Orin on your network.
                  </p>
                </div>
                <Switch
                  checked={scannerSettings.gpuOffloadEnabled}
                  onCheckedChange={(checked) => updateScannerSettings({ gpuOffloadEnabled: checked })}
                />
              </div>

              {scannerSettings.gpuOffloadEnabled && (
                <div className="space-y-4 pt-2 border-t border-border">
                  {/* Server type badge */}
                  {discoveredServer && (
                    <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2.5">
                      <Zap className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">
                        {discoveredServer.type === "jetson" ? "Jetson Orin" : "Mac/PC"} connected
                      </span>
                      {discoveredServer.gpu?.gpu_temp_c && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          GPU {discoveredServer.gpu.gpu_temp_c.toFixed(0)}°C
                        </span>
                      )}
                    </div>
                  )}

                  <div className="grid gap-2">
                    <Label className="text-sm font-medium">Server Base URL</Label>
                    <div className="flex gap-2">
                      <Input
                        value={scannerSettings.gpuServerBaseUrl}
                        onChange={(e) => updateScannerSettings({ gpuServerBaseUrl: e.target.value })}
                        placeholder="192.168.1.5:8000"
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isDiscovering}
                        onClick={async () => {
                          setIsDiscovering(true);
                          setDiscoveredServer(null);
                          try {
                            // Subnet sweep: try common local IPs on port 8000
                            const candidates: string[] = [];
                            // If URL already set, check it first
                            if (scannerSettings.gpuServerBaseUrl) {
                              candidates.push(scannerSettings.gpuServerBaseUrl);
                            }
                            // Common local ranges
                            for (let i = 1; i <= 254; i++) {
                              candidates.push(`192.168.1.${i}:8000`);
                              candidates.push(`192.168.0.${i}:8000`);
                              if (candidates.length > 60) break; // Limit sweep
                            }
                            // Try in batches
                            const check = async (host: string) => {
                              const url = host.startsWith("http") ? host : `http://${host}`;
                              try {
                                const ctrl = new AbortController();
                                const timer = setTimeout(() => ctrl.abort(), 1500);
                                const res = await fetch(`${url}/health`, { signal: ctrl.signal });
                                clearTimeout(timer);
                                if (res.ok) {
                                  const data = await res.json();
                                  const caps = data?.capabilities ?? {};
                                  return { url: host, type: caps.platform ?? "mac", gpu: data?.gpu };
                                }
                              } catch { /* skip */ }
                              return null;
                            };
                            // Check 20 at a time
                            for (let i = 0; i < candidates.length; i += 20) {
                              const batch = candidates.slice(i, i + 20);
                              const results = await Promise.all(batch.map(check));
                              const found = results.find(r => r !== null);
                              if (found) {
                                setDiscoveredServer(found);
                                updateScannerSettings({
                                  gpuServerBaseUrl: found.url,
                                  gpuServerType: found.type === "jetson" ? "jetson" : "mac",
                                });
                                // Auto-tune for Jetson
                                if (found.type === "jetson") {
                                  updateScannerSettings({
                                    gpuStreamMaxFps: 24,
                                    gpuStreamTargetWidth: 1080,
                                    gpuStreamJpegQuality: 0.75,
                                  });
                                }
                                toast.success(`Found ${found.type === "jetson" ? "Jetson Orin" : "Mac/PC"} server at ${found.url}`);
                                break;
                              }
                            }
                            if (!discoveredServer) {
                              toast.error("No servers found on local network");
                            }
                          } catch {
                            toast.error("Discovery failed");
                          } finally {
                            setIsDiscovering(false);
                          }
                        }}
                      >
                        <Search className="h-4 w-4 mr-1" />
                        {isDiscovering ? "Scanning..." : "Discover"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Click Discover to auto-find servers, or manually enter an IP.
                    </p>
                  </div>

                  {/* Server type selector */}
                  <div className="grid gap-2">
                    <Label className="text-sm font-medium">Server Type</Label>
                    <div className="flex gap-2">
                      {(["auto", "mac", "jetson"] as const).map(t => (
                        <Button
                          key={t}
                          variant={scannerSettings.gpuServerType === t ? "default" : "outline"}
                          size="sm"
                          onClick={() => updateScannerSettings({ gpuServerType: t })}
                        >
                          {t === "auto" ? "Auto-detect" : t === "jetson" ? "Jetson Orin" : "Mac/PC"}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-medium">Use for queue processing</Label>
                        <p className="text-xs text-muted-foreground">Rapid Scan queue will prefer the local server.</p>
                      </div>
                      <Switch
                        checked={scannerSettings.gpuPreferForQueue}
                        onCheckedChange={(checked) => updateScannerSettings({ gpuPreferForQueue: checked })}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-medium">Use for live preview</Label>
                        <p className="text-xs text-muted-foreground">Shows live overlay while aiming the camera.</p>
                      </div>
                      <Switch
                        checked={scannerSettings.gpuPreferForLive}
                        onCheckedChange={(checked) => updateScannerSettings({ gpuPreferForLive: checked })}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      Live Stream FPS: {scannerSettings.gpuStreamMaxFps}
                    </Label>
                    <Slider
                      min={2}
                      max={30}
                      step={1}
                      value={[scannerSettings.gpuStreamMaxFps]}
                      onValueChange={(value) => updateScannerSettings({ gpuStreamMaxFps: value[0] })}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>2</span>
                      <span>30</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      Stream Width: {scannerSettings.gpuStreamTargetWidth}px
                    </Label>
                    <Slider
                      min={320}
                      max={1280}
                      step={80}
                      value={[scannerSettings.gpuStreamTargetWidth]}
                      onValueChange={(value) => updateScannerSettings({ gpuStreamTargetWidth: value[0] })}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>320</span>
                      <span>1280</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      JPEG Quality: {scannerSettings.gpuStreamJpegQuality}
                    </Label>
                    <Slider
                      min={0.35}
                      max={0.95}
                      step={0.05}
                      value={[scannerSettings.gpuStreamJpegQuality]}
                      onValueChange={(value) => updateScannerSettings({ gpuStreamJpegQuality: Number(value[0].toFixed(2)) })}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0.35</span>
                      <span>0.95</span>
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    Tip: For Jetson Orin, run <span className="font-mono">sudo bash bootstrap.sh</span> to set up the server. It will auto-announce via mDNS.
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Collection Management */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Collection Management
          </CardTitle>
          <CardDescription>Manage your card collection ({totalCards} total cards)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Cards Needing Review - Priority fix queue */}
          <CardsNeedingReview />

          <Separator />

          <div className="grid gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Clean and normalize imported card data for better matching
              </p>
              <Button 
                variant="outline" 
                onClick={() => navigate('/import-cleaner')}
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Import Cleaner
              </Button>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Find and download missing card images from official databases
              </p>
              <Button 
                variant="outline" 
                onClick={() => navigate('/image-backfill')}
              >
                <ImageIcon className="h-4 w-4 mr-2" />
                Image Backfill Tool
              </Button>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Update all card prices from market data
              </p>
              <Button 
                variant="outline" 
                onClick={handleUpdatePrices}
                disabled={isUpdatingPrices || totalCards === 0}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isUpdatingPrices ? 'animate-spin' : ''}`} />
                Update All Prices {totalCards > 0 ? `(${totalCards} cards)` : ''}
              </Button>
            </div>

            <Separator />

            {/* Bulk Price Refresh for missing prices */}
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Fetch prices for cards that are missing price data
              </p>
              <BulkPriceRefresh />
            </div>

            <Separator />

            {/* Bulk PSA 10 Price Update */}
            <BulkPSA10Update />

            <Separator />
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                {noImageCount > 0 
                  ? `Delete ${noImageCount} card(s) that have no images` 
                  : 'No cards without images found'}
              </p>
              <Button 
                variant="outline"
                onClick={() => setShowDeleteNoImage(true)}
                disabled={noImageCount === 0}
              >
                <ImageOff className="h-4 w-4 mr-2" />
                Delete No-Image Cards {noImageCount > 0 ? `(${noImageCount})` : ''}
              </Button>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground mb-2">
                {recentImportCount > 0
                  ? `Delete ${recentImportCount} card(s) imported in the last ${recentTimeRange} hours`
                  : `No recent imports found (last ${recentTimeRange} hours)`}
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={recentTimeRange}
                  onChange={(e) => setRecentTimeRange(Number(e.target.value))}
                  className="h-9 rounded-md border border-border bg-card text-sm px-2"
                >
                  <option value={2}>2 hours</option>
                  <option value={4}>4 hours</option>
                  <option value={6}>6 hours</option>
                </select>
                <Button 
                  variant="outline"
                  onClick={() => setShowDeleteRecent(true)}
                  disabled={recentImportCount === 0}
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Delete Recent Import {recentImportCount > 0 ? `(${recentImportCount})` : ''}
                </Button>
              </div>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground mb-2">
                {unknownCardCount > 0
                  ? `Delete ${unknownCardCount} card(s) with "Unknown Card" name`
                  : 'No unknown cards found'}
              </p>
              <Button 
                variant="outline"
                onClick={() => setShowDeleteUnknown(true)}
                disabled={unknownCardCount === 0}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Unknown Cards {unknownCardCount > 0 ? `(${unknownCardCount})` : ''}
              </Button>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-destructive mb-2">
                {totalCards > 0
                  ? `Permanently delete all ${totalCards} cards in your collection`
                  : 'No cards to delete'}
              </p>
              <Button 
                variant="destructive"
                onClick={() => setShowClearAll(true)}
                disabled={totalCards === 0}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Entire Collection {totalCards > 0 ? `(${totalCards} cards)` : ''}
              </Button>
            </div>

            <Separator />

            {/* Bulk Rarity Re-analyze */}
            <BulkRarityReanalyze 
              nullRarityCount={nullRarityCount} 
              onComplete={loadCollectionStats} 
            />

            <Separator />

            {/* Bulk Image Lookup */}
            <BulkImageLookup onComplete={loadCollectionStats} />

            <Separator />

            {/* Bulk Card Re-identify and Image Lookup */}
            <BulkCardReidentify onComplete={loadCollectionStats} />
          </div>
        </CardContent>
      </Card>

      {/* Data Management - Service Import/Export */}
      <ServiceImportExport 
        userId={userId} 
        totalCards={totalCards} 
        onComplete={loadCollectionStats} 
      />


      {/* Queue Stress Test Toggle */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                Developer Tools
              </CardTitle>
              <CardDescription>Advanced testing and debugging tools</CardDescription>
            </div>
            <Switch
              checked={showStressTest}
              onCheckedChange={setShowStressTest}
            />
          </div>
        </CardHeader>
      </Card>

      {showStressTest && <QueueStressTest />}

      {/* Offline Storage */}
      <OfflineStoragePanel />

      {/* Device Storage (Android/iOS only) */}
      <DeviceStorageSettings />

      {/* Account Actions */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Account Actions</CardTitle>
          <CardDescription>Manage your account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Button variant="outline" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>

          <Separator />

          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Permanently delete your account and all associated data
            </p>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Card Collection Manager v1.0.0</p>
          <p>© 2024 Card Collection Manager. All rights reserved.</p>
        </CardContent>
      </Card>

      {/* Delete Account Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete your account? This will permanently delete
              all your cards, collections, and data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change Password Dialog */}
      <AlertDialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Password</AlertDialogTitle>
            <AlertDialogDescription>
              Enter your new password below
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleChangePassword}>
              Update Password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete No-Image Cards Dialog */}
      <AlertDialog open={showDeleteNoImage} onOpenChange={setShowDeleteNoImage}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cards Without Images</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {noImageCount} card(s) that have no images? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteNoImage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {noImageCount} Card(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Recent Import Dialog */}
      <AlertDialog open={showDeleteRecent} onOpenChange={setShowDeleteRecent}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recent Import</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {recentImportCount} card(s) imported in the last {recentTimeRange} hours? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRecent}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Recent Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Unknown Cards Dialog */}
      <AlertDialog open={showDeleteUnknown} onOpenChange={setShowDeleteUnknown}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Unknown Cards</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {unknownCardCount} card(s) with "Unknown Card" name? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUnknown}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {unknownCardCount} Unknown Card(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear All Cards Dialog */}
      <AlertDialog open={showClearAll} onOpenChange={setShowClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Entire Collection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete ALL {totalCards} cards in your collection? This will permanently delete your entire collection and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete All {totalCards} Cards
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
