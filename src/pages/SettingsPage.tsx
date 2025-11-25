import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Download, LogOut, Trash2, User, Lock, Upload, ImageOff, Clock, RefreshCw, Database } from "lucide-react";
import * as XLSX from "xlsx";
import { Progress } from "@/components/ui/progress";

export default function Settings() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showDeleteNoImage, setShowDeleteNoImage] = useState(false);
  const [noImageCount, setNoImageCount] = useState(0);
  const [showDeleteRecent, setShowDeleteRecent] = useState(false);
  const [recentImportCount, setRecentImportCount] = useState(0);
  const [showClearAll, setShowClearAll] = useState(false);
  const [totalCards, setTotalCards] = useState(0);
  const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);

  useEffect(() => {
    loadUserData();
    loadCollectionStats();
  }, []);

  const loadUserData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setEmail(user.email || "");

      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
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
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("profiles")
        .update({ username })
        .eq("id", user.id);

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

  const handleExportData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: cards, error } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", user.id);

      if (error) throw error;

      const worksheet = XLSX.utils.json_to_sheet(cards || []);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Cards");
      
      XLSX.writeFile(workbook, `card-collection-${new Date().toISOString().split('T')[0]}.xlsx`);
      
      toast.success("Collection exported successfully");
    } catch (error) {
      console.error("Error exporting data:", error);
      toast.error("Failed to export collection");
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      navigate("/auth");
      toast.success("Signed out successfully");
    } catch (error) {
      console.error("Error signing out:", error);
      toast.error("Failed to sign out");
    }
  };

  const handleImportData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to import cards");
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          if (jsonData.length === 0) {
            toast.error("No data found in file");
            setImporting(false);
            return;
          }

          // Process cards in batches
          const batchSize = 10;
          let imported = 0;

          for (let i = 0; i < jsonData.length; i += batchSize) {
            const batch = jsonData.slice(i, i + batchSize);
            const cardsToInsert = batch.map((row: any) => ({
              user_id: user.id,
              card_name: row["Card Name"] || row["card_name"] || "Unknown Card",
              card_set: row["Set"] || row["card_set"] || null,
              card_number: row["Card Number"] || row["card_number"] || null,
              rarity: row["Rarity"] || row["rarity"] || null,
              condition: row["Condition"] || row["condition"] || "ungraded",
              current_price_raw: parseFloat(row["Price (Raw)"] || row["Price"] || row["current_price_raw"] || 0),
              current_price_psa9: parseFloat(row["Price (PSA 9)"] || row["current_price_psa9"] || 0),
              current_price_psa10: parseFloat(row["Price (PSA 10)"] || row["current_price_psa10"] || 0),
              collection_name: row["Collection"] || row["collection_name"] || null,
              image_url: row["Image URL"] || row["image_url"] || "https://placehold.co/300x400?text=No+Image",
            }));

            await supabase.from("cards").insert(cardsToInsert);
            imported += batch.length;
            setImportProgress(Math.round(((i + batch.length) / jsonData.length) * 100));
          }

          toast.success(`Successfully imported ${imported} cards`);
        } catch (error) {
          console.error("Import error:", error);
          toast.error("Failed to process file");
        } finally {
          setImporting(false);
          setImportProgress(0);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }
      };

      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error("File read error:", error);
      toast.error("Failed to read file");
      setImporting(false);
    }
  };

  const loadCollectionStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get total cards count
      const { count: total } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", user.id);
      
      setTotalCards(total || 0);

      // Get no-image cards count
      const { count: noImage } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", user.id)
        .or("image_url.is.null,image_url.eq.");
      
      setNoImageCount(noImage || 0);

      // Get recent imports count (last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count: recent } = await supabase
        .from("cards")
        .select("*", { count: 'exact', head: true })
        .eq("user_id", user.id)
        .gte("created_at", fiveMinutesAgo);
      
      setRecentImportCount(recent || 0);
    } catch (error) {
      console.error("Error loading collection stats:", error);
    }
  };

  const handleDeleteNoImage = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", user.id)
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
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", user.id)
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
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("user_id", user.id);

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

  const handleUpdatePrices = async () => {
    try {
      setIsUpdatingPrices(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to update prices");
        return;
      }

      toast.loading("Updating prices...", { id: "price-update" });

      const { data, error } = await supabase.functions.invoke("update-prices", {
        body: { user_id: user.id },
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
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Delete all user data
      await supabase.from("cards").delete().eq("user_id", user.id);
      await supabase.from("profiles").delete().eq("id", user.id);
      
      // Note: Actual user deletion from auth.users requires admin privileges
      // For now, we'll sign them out after deleting their data
      await supabase.auth.signOut();
      
      navigate("/auth");
      toast.success("Account data deleted successfully");
    } catch (error) {
      console.error("Error deleting account:", error);
      toast.error("Failed to delete account");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
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
          </div>
        </CardContent>
      </Card>

      {/* Data Management */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Import / Export
          </CardTitle>
          <CardDescription>Import or export your collection data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {importing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Importing cards...</span>
                <span>{importProgress}%</span>
              </div>
              <Progress value={importProgress} />
            </div>
          )}
          
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Export your entire card collection as an Excel file
            </p>
            <Button variant="outline" onClick={handleExportData}>
              <Download className="h-4 w-4 mr-2" />
              Export Collection
            </Button>
          </div>

          <Separator />

          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Import cards from Excel or CSV file. Required column: Card Name
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportData}
              className="hidden"
              disabled={importing}
            />
            <Button 
              variant="outline" 
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Collection
            </Button>
          </div>
        </CardContent>
      </Card>

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
