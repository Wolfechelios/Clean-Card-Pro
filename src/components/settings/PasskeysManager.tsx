import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Fingerprint, Trash2, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  isPasskeySupported,
  hasPlatformAuthenticator,
  registerPasskey,
  markPasskeyRegistered,
} from "@/lib/passkey";

interface Passkey {
  id: string;
  device_label: string;
  created_at: string;
  last_used_at: string;
}

export function PasskeysManager() {
  const { user } = useAuth();
  const [list, setList] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(false);
  const [hasPlatform, setHasPlatform] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_passkeys")
      .select("id, device_label, created_at, last_used_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setList((data ?? []) as Passkey[]);
  };

  useEffect(() => {
    setSupported(isPasskeySupported());
    hasPlatformAuthenticator().then(setHasPlatform);
    load();
  }, [user]);

  const enroll = async () => {
    setLoading(true);
    try {
      await registerPasskey();
      if (user) markPasskeyRegistered(user.id);
      toast.success("Passkey added");
      load();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/cancel|abort|NotAllowed/i.test(msg)) toast.error(msg || "Failed");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("user_passkeys").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Passkey removed");
    load();
  };

  const saveLabel = async (id: string) => {
    const { error } = await supabase.from("user_passkeys").update({ device_label: editLabel }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingId(null);
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-5 w-5" /> Passkeys
        </CardTitle>
        <CardDescription>
          Sign in with Face ID, Touch ID, or your device PIN. No password needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported && (
          <p className="text-sm text-muted-foreground">This browser doesn't support passkeys.</p>
        )}
        {supported && !hasPlatform && (
          <p className="text-sm text-muted-foreground">
            No platform authenticator detected on this device.
          </p>
        )}

        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No passkeys registered yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {list.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <Fingerprint className="h-4 w-4 text-primary" />
                <div className="flex-1 min-w-0">
                  {editingId === p.id ? (
                    <div className="flex gap-2">
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="h-8"
                      />
                      <Button size="icon" variant="ghost" onClick={() => saveLabel(p.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(p.id);
                        setEditLabel(p.device_label);
                      }}
                      className="text-left"
                    >
                      <p className="truncate text-sm font-medium">{p.device_label}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {new Date(p.created_at).toLocaleDateString()} · Last used{" "}
                        {new Date(p.last_used_at).toLocaleDateString()}
                      </p>
                    </button>
                  )}
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(p.id)} aria-label="Remove">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {supported && hasPlatform && (
          <Button onClick={enroll} disabled={loading} className="gap-2">
            <Plus className="h-4 w-4" />
            {loading ? "Setting up..." : "Add passkey for this device"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
