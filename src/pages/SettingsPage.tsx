import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { User, Shield, Bell, Database, LogOut, Save } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useNavigate } from "react-router-dom";

interface Profile {
  id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [priceAlerts, setPriceAlerts] = useState(true);
  const [scanAlerts, setScanAlerts] = useState(false);
  
  const [totalCards, setTotalCards] = useState(0);
  const [totalValue, setTotalValue] = useState(0);

  useEffect(() => {
    fetchProfile();
    fetchStats();
  }, []);

  const fetchProfile = async () => {
    setIsLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();

    if (data) {
      setProfile(data);
      setUsername(data.username || "");
      setEmail(data.email || session.user.email || "");
    }
    setIsLoading(false);
  };

  const fetchStats = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: cards } = await supabase
      .from("cards")
      .select("current_price_raw")
      .eq("user_id", session.user.id);

    if (cards) {
      setTotalCards(cards.length);
      const value = cards.reduce((sum, card) => sum + (card.current_price_raw || 0), 0);
      setTotalValue(value);
    }
  };

  const updateProfile = async () => {
    setIsSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from("profiles")
      .update({ username, email })
      .eq("id", session.user.id);

    if (error) {
      toast.error("Failed to update profile");
    } else {
      toast.success("Profile updated successfully");
      fetchProfile();
    }
    setIsSaving(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    navigate("/auth");
  };

  const exportAllData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: cards } = await supabase
      .from("cards")
      .select("*")
      .eq("user_id", session.user.id);

    if (cards) {
      const dataStr = JSON.stringify(cards, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `card-data-${Date.now()}.json`;
      link.click();
      toast.success("Data exported successfully");
    }
  };

  const deleteAllData = async () => {
    if (!confirm("Are you sure you want to delete all your cards? This action cannot be undone.")) {
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from("cards")
      .delete()
      .eq("user_id", session.user.id);

    if (error) {
      toast.error("Failed to delete data");
    } else {
      toast.success("All data deleted");
      fetchStats();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-3xl font-bold">Settings</h1>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-neutral-900">
          <TabsTrigger value="profile">
            <User className="mr-2 h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="data">
            <Database className="mr-2 h-4 w-4" />
            Data
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="mr-2 h-4 w-4" />
            Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your account details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-neutral-800 border-neutral-700"
                />
              </div>
              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="bg-neutral-800 border-neutral-700"
                />
              </div>
              <Button onClick={updateProfile} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle>Account Statistics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-neutral-400">Total Cards</span>
                <span className="font-bold">{totalCards}</span>
              </div>
              <Separator className="bg-neutral-700" />
              <div className="flex justify-between">
                <span className="text-neutral-400">Total Value</span>
                <span className="font-bold">${totalValue.toFixed(2)}</span>
              </div>
              <Separator className="bg-neutral-700" />
              <div className="flex justify-between">
                <span className="text-neutral-400">Member Since</span>
                <span className="font-bold">
                  {profile?.id ? new Date().toLocaleDateString() : "N/A"}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Manage how you receive updates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Email Notifications</p>
                  <p className="text-sm text-neutral-400">Receive updates via email</p>
                </div>
                <Switch
                  checked={emailNotifications}
                  onCheckedChange={setEmailNotifications}
                />
              </div>
              <Separator className="bg-neutral-700" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Price Alerts</p>
                  <p className="text-sm text-neutral-400">Get notified when card prices change</p>
                </div>
                <Switch
                  checked={priceAlerts}
                  onCheckedChange={setPriceAlerts}
                />
              </div>
              <Separator className="bg-neutral-700" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Scan Alerts</p>
                  <p className="text-sm text-neutral-400">Notifications for completed scans</p>
                </div>
                <Switch
                  checked={scanAlerts}
                  onCheckedChange={setScanAlerts}
                />
              </div>
              <Button onClick={() => toast.success("Notification settings saved")}>
                <Save className="mr-2 h-4 w-4" />
                Save Preferences
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle>Data Management</CardTitle>
              <CardDescription>Export or delete your collection data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-medium mb-2">Export Data</h3>
                <p className="text-sm text-neutral-400 mb-3">
                  Download all your card data as a JSON file
                </p>
                <Button onClick={exportAllData} variant="outline">
                  <Database className="mr-2 h-4 w-4" />
                  Export All Data
                </Button>
              </div>
              <Separator className="bg-neutral-700" />
              <div>
                <h3 className="font-medium mb-2 text-red-500">Danger Zone</h3>
                <p className="text-sm text-neutral-400 mb-3">
                  Permanently delete all your card data. This cannot be undone.
                </p>
                <Button onClick={deleteAllData} variant="destructive">
                  Delete All Data
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Manage your account security</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-medium mb-2">Password</h3>
                <p className="text-sm text-neutral-400 mb-3">
                  Change your password to keep your account secure
                </p>
                <Button variant="outline" disabled>
                  Change Password (Coming Soon)
                </Button>
              </div>
              <Separator className="bg-neutral-700" />
              <div>
                <h3 className="font-medium mb-2">Two-Factor Authentication</h3>
                <p className="text-sm text-neutral-400 mb-3">
                  Add an extra layer of security to your account
                </p>
                <Button variant="outline" disabled>
                  Enable 2FA (Coming Soon)
                </Button>
              </div>
              <Separator className="bg-neutral-700" />
              <div>
                <h3 className="font-medium mb-2">Sign Out</h3>
                <p className="text-sm text-neutral-400 mb-3">
                  Sign out of your account on this device
                </p>
                <Button onClick={handleSignOut} variant="destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
