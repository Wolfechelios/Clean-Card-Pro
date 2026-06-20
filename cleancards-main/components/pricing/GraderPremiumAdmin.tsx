import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, RefreshCw, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface GraderPremium {
  id: string;
  grader: string;
  grade: string;
  premium_multiplier: number;
  notes: string | null;
}

export function GraderPremiumAdmin() {
  const [premiums, setPremiums] = useState<GraderPremium[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [cacheTTL, setCacheTTL] = useState(6);

  useEffect(() => {
    fetchPremiums();
  }, []);

  const fetchPremiums = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("grader_premiums")
      .select("*")
      .order("grader")
      .order("grade", { ascending: false });

    if (error) {
      toast.error("Failed to load grader premiums");
      console.error(error);
    } else {
      setPremiums(data || []);
    }
    setLoading(false);
  };

  const handleChange = (id: string, value: number) => {
    setChanges(prev => ({ ...prev, [id]: value }));
  };

  const saveChanges = async () => {
    setSaving(true);
    const updates = Object.entries(changes).map(([id, premium_multiplier]) => ({
      id,
      premium_multiplier,
      updated_at: new Date().toISOString(),
    }));

    for (const update of updates) {
      const { error } = await supabase
        .from("grader_premiums")
        .update({ 
          premium_multiplier: update.premium_multiplier,
          updated_at: update.updated_at 
        })
        .eq("id", update.id);

      if (error) {
        toast.error(`Failed to update ${update.id}`);
        console.error(error);
      }
    }

    toast.success("Premium multipliers updated");
    setChanges({});
    fetchPremiums();
    setSaving(false);
  };

  const clearCache = async () => {
    const { error } = await supabase
      .from("graded_pricing_cache")
      .delete()
      .lt("expires_at", new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString());

    if (error) {
      toast.error("Failed to clear cache");
    } else {
      toast.success("Pricing cache cleared");
    }
  };

  const graderGroups = premiums.reduce((acc, p) => {
    if (!acc[p.grader]) acc[p.grader] = [];
    acc[p.grader].push(p);
    return acc;
  }, {} as Record<string, GraderPremium[]>);

  const graderColors: Record<string, string> = {
    PSA: "bg-red-500/10 text-red-500 border-red-500/20",
    BGS: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    CGC: "bg-green-500/10 text-green-500 border-green-500/20",
  };

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Admin Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Admin Settings
        </CardTitle>
        <CardDescription>
          Configure grader premium multipliers and cache settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Cache Settings */}
        <div className="p-4 bg-muted/30 rounded-lg space-y-3">
          <h4 className="font-medium text-foreground">Cache Settings</h4>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="cacheTTL" className="text-sm">Cache TTL (hours)</Label>
              <Input
                id="cacheTTL"
                type="number"
                min="1"
                max="24"
                value={cacheTTL}
                onChange={(e) => setCacheTTL(parseInt(e.target.value) || 6)}
                className="mt-1"
              />
            </div>
            <Button variant="outline" onClick={clearCache} className="mt-6">
              <RefreshCw className="h-4 w-4 mr-2" />
              Clear Cache
            </Button>
          </div>
        </div>

        {/* Grader Premiums */}
        <div className="space-y-4">
          <h4 className="font-medium text-foreground">Grade Premium Multipliers</h4>
          <p className="text-sm text-muted-foreground">
            Multipliers applied to base prices. 1.0 = baseline (PSA 10).
          </p>

          {Object.entries(graderGroups).map(([grader, grades]) => (
            <div key={grader} className="p-4 bg-muted/20 rounded-lg space-y-3">
              <Badge className={graderColors[grader] || ""}>{grader}</Badge>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {grades.map((p) => (
                  <div key={p.id}>
                    <Label className="text-xs text-muted-foreground">
                      Grade {p.grade}
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="5"
                      value={changes[p.id] ?? p.premium_multiplier}
                      onChange={(e) => handleChange(p.id, parseFloat(e.target.value) || 0)}
                      className="mt-1 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Save Button */}
        {Object.keys(changes).length > 0 && (
          <Button onClick={saveChanges} disabled={saving} className="w-full">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : `Save ${Object.keys(changes).length} Changes`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}