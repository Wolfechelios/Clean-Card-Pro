import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Key, Plus, Trash2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface UserApiKey {
  id: string;
  key_name: string;
  key_value: string;
  is_active: boolean;
  created_at: string;
}

const SUPPORTED_KEYS = [
  { name: "GEMINI_API_KEY", label: "Gemini API Key", description: "For AI card identification" },
  { name: "GOOGLE_VISION_API_KEY", label: "Google Vision API Key", description: "For OCR text extraction" },
  { name: "PERPLEXITY_API_KEY", label: "Perplexity API Key", description: "For price research" },
];

export function UserApiKeysManager() {
  const { userId } = useAuth();
  const [keys, setKeys] = useState<UserApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [newKeyValues, setNewKeyValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (userId) {
      fetchKeys();
    }
  }, [userId]);

  const fetchKeys = async () => {
    try {
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("*")
        .order("key_name");

      if (error) throw error;
      setKeys(data || []);
    } catch (err) {
      console.error("Error fetching API keys:", err);
      toast.error("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  };

  const saveKey = async (keyName: string) => {
    const value = newKeyValues[keyName];
    if (!value?.trim()) {
      toast.error("Please enter a key value");
      return;
    }

    setSaving(keyName);
    try {
      const existingKey = keys.find(k => k.key_name === keyName);

      if (existingKey) {
        const { error } = await supabase
          .from("user_api_keys")
          .update({ key_value: value.trim(), is_active: true })
          .eq("id", existingKey.id);

        if (error) throw error;
        toast.success(`${keyName} updated`);
      } else {
        const { error } = await supabase
          .from("user_api_keys")
          .insert({
            user_id: userId,
            key_name: keyName,
            key_value: value.trim(),
            is_active: true,
          });

        if (error) throw error;
        toast.success(`${keyName} added`);
      }

      setNewKeyValues(prev => ({ ...prev, [keyName]: "" }));
      fetchKeys();
    } catch (err) {
      console.error("Error saving API key:", err);
      toast.error("Failed to save API key");
    } finally {
      setSaving(null);
    }
  };

  const toggleKey = async (key: UserApiKey) => {
    try {
      const { error } = await supabase
        .from("user_api_keys")
        .update({ is_active: !key.is_active })
        .eq("id", key.id);

      if (error) throw error;
      toast.success(`${key.key_name} ${key.is_active ? "disabled" : "enabled"}`);
      fetchKeys();
    } catch (err) {
      console.error("Error toggling API key:", err);
      toast.error("Failed to update API key");
    }
  };

  const deleteKey = async (key: UserApiKey) => {
    try {
      const { error } = await supabase
        .from("user_api_keys")
        .delete()
        .eq("id", key.id);

      if (error) throw error;
      toast.success(`${key.key_name} deleted`);
      fetchKeys();
    } catch (err) {
      console.error("Error deleting API key:", err);
      toast.error("Failed to delete API key");
    }
  };

  const maskValue = (value: string) => {
    if (value.length <= 8) return "••••••••";
    return value.slice(0, 4) + "••••••••" + value.slice(-4);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Your API Keys
        </CardTitle>
        <CardDescription>
          Add your own API keys to use instead of shared system keys. Your keys are encrypted and only accessible by you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <AlertDescription>
            When you add your own API keys, they'll be used for your scans instead of shared keys. 
            This gives you higher rate limits and ensures your usage is separate from other users.
          </AlertDescription>
        </Alert>

        {SUPPORTED_KEYS.map(({ name, label, description }) => {
          const existingKey = keys.find(k => k.key_name === name);
          const isShowingValue = showValues[name];

          return (
            <div key={name} className="space-y-3 p-4 border rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-medium">{label}</Label>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
                {existingKey && (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={existingKey.is_active}
                      onCheckedChange={() => toggleKey(existingKey)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteKey(existingKey)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              {existingKey ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 font-mono text-sm bg-muted px-3 py-2 rounded">
                    {isShowingValue ? existingKey.key_value : maskValue(existingKey.key_value)}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowValues(prev => ({ ...prev, [name]: !prev[name] }))}
                  >
                    {isShowingValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={`Enter your ${label}`}
                    value={newKeyValues[name] || ""}
                    onChange={(e) => setNewKeyValues(prev => ({ ...prev, [name]: e.target.value }))}
                  />
                  <Button
                    onClick={() => saveKey(name)}
                    disabled={saving === name || !newKeyValues[name]?.trim()}
                  >
                    {saving === name ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Add
                  </Button>
                </div>
              )}

              {existingKey && (
                <p className="text-xs text-muted-foreground">
                  {existingKey.is_active ? "✓ Active - using your key" : "○ Disabled - using system key"}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
