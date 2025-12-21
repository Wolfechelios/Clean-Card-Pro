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
import { LogOut, Trash2, User, Lock, ImageOff, Clock, RefreshCw, Database, ScanLine, ImageIcon, Wand2 } from "lucide-react";

import ServiceImportExport from "@/components/settings/ServiceImportExport";
import DeviceStorageSettings from "@/components/settings/DeviceStorageSettings";
import { BulkRarityReanalyze } from "@/components/collections/BulkRarityReanalyze";
import { BulkImageLookup } from "@/components/collections/BulkImageLookup";
import { BulkCardReidentify } from "@/components/settings/BulkCardReidentify";
import { BulkPSA10Update } from "@/components/pricing/BulkPSA10Update";
import { SettingsSkeleton } from "@/components/ui/loading-skeletons";
import { useScannerSettings } from "@/hooks/use-scanner-settings";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export default function Settings() {
  const navigate = useNavigate();
  const { user, userId, signOut } = useAuth();
  const { settings: scannerSettings, updateSettings: updateScannerSettings } = useScannerSettings();
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
  const [showClearAll, setShowClearAll] = useState(false);
  const [totalCards, setTotalCards] = useState(0);
  const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
  const [showDeleteUnknown, setShowDeleteUnknown] = useState(false);
  const [unknownCardCount, setUnknownCardCount] = useState(0);
  const [nullRarityCount, setNullRarityCount] = useState(0);

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

      // Get recent imports count (last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count: recent } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId)
        .gte("created_at", fiveMinutesAgo);
      
      setRecentImportCount(recent || 0);

      // Get unknown cards count
      const { count: unknown } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId)
        .eq("card_name", "Unknown Card");
      
      setUnknownCardCount(unknown || 0);

      // Get null rarity cards count
      const { count: nullRarity } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", userId)
        .is("rarity", null);
      
      setNullRarityCount(nullRarity || 0);
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
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", userId)
        .gte("created_at", fiveMinutesAgo);

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
      // Delete all user data
      await supabase.from("cards").delete().eq("user_id", userId);
      await supabase.from("profiles").delete().eq("id", userId);
      
      // Note: Actual user deletion from auth.users requires admin privileges
      // For now, we'll sign them out after deleting their data
      await signOut();
      
      navigate("/auth");
      toast.success("Account data deleted successfully");
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
        <CardContent className="space-y-4">
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
                  ? `Delete ${recentImportCount} card(s) imported in the last 5 minutes`
                  : 'No recent imports found (last 5 minutes)'}
              </p>
              <Button 
                variant="outline"
                onClick={() => setShowDeleteRecent(true)}
                disabled={recentImportCount === 0}
              >
                <Clock className="h-4 w-4 mr-2" />
                Delete Recent Import {recentImportCount > 0 ? `(${recentImportCount})` : ''}
              </Button>
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
              Are you sure you want to delete {recentImportCount} card(s) imported in the last 5 minutes? This action cannot be undone.
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
