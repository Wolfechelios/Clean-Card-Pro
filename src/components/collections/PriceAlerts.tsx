import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bell, Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface PriceAlert {
  id: string;
  card_id: string;
  alert_type: string;
  threshold_value: number | null;
  percentage_value: number | null;
  is_active: boolean;
  card?: {
    card_name: string;
    current_price_raw: number;
  };
}

interface PriceAlertsProps {
  cards: Array<{ id: string; card_name: string; current_price_raw: number | null }>;
}

export default function PriceAlerts({ cards }: PriceAlertsProps) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [alertType, setAlertType] = useState<"price_increase" | "price_decrease" | "threshold" | "percentage_change">("threshold");
  const [thresholdValue, setThresholdValue] = useState("");
  const [percentageValue, setPercentageValue] = useState("");

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data, error } = await supabase
      .from("price_alerts")
      .select(`
        *,
        card:cards(card_name, current_price_raw)
      `)
      .eq("user_id", session.user.id);

    if (!error && data) {
      setAlerts(data as any);
    }
  };

  const createAlert = async () => {
    if (!selectedCardId) {
      toast.error("Please select a card");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const alertData: any = {
      user_id: session.user.id,
      card_id: selectedCardId,
      alert_type: alertType,
      is_active: true,
    };

    if (alertType === "threshold" && thresholdValue) {
      alertData.threshold_value = parseFloat(thresholdValue);
    } else if (alertType === "percentage_change" && percentageValue) {
      alertData.percentage_value = parseFloat(percentageValue);
    }

    const { error } = await supabase
      .from("price_alerts")
      .insert(alertData);

    if (error) {
      if (error.code === "23505") {
        toast.error("Alert already exists for this card and type");
      } else {
        toast.error("Failed to create alert");
      }
    } else {
      toast.success("Price alert created");
      setShowCreateDialog(false);
      resetForm();
      loadAlerts();
    }
  };

  const toggleAlert = async (alertId: string, isActive: boolean) => {
    const { error } = await supabase
      .from("price_alerts")
      .update({ is_active: isActive })
      .eq("id", alertId);

    if (error) {
      toast.error("Failed to update alert");
    } else {
      loadAlerts();
      toast.success(isActive ? "Alert enabled" : "Alert disabled");
    }
  };

  const deleteAlert = async (alertId: string) => {
    const { error } = await supabase
      .from("price_alerts")
      .delete()
      .eq("id", alertId);

    if (error) {
      toast.error("Failed to delete alert");
    } else {
      toast.success("Alert deleted");
      loadAlerts();
    }
  };

  const resetForm = () => {
    setSelectedCardId("");
    setAlertType("threshold");
    setThresholdValue("");
    setPercentageValue("");
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "price_increase":
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case "price_decrease":
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };

  const getAlertDescription = (alert: PriceAlert) => {
    const cardName = alert.card?.card_name || "Unknown Card";
    switch (alert.alert_type) {
      case "price_increase":
        return `${cardName} - Alert on any price increase`;
      case "price_decrease":
        return `${cardName} - Alert on any price decrease`;
      case "threshold":
        return `${cardName} - Alert when price reaches $${alert.threshold_value}`;
      case "percentage_change":
        return `${cardName} - Alert on ${alert.percentage_value}% price change`;
      default:
        return cardName;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Price Alerts
            </CardTitle>
            <CardDescription>Get notified when card prices change</CardDescription>
          </div>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create Alert
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Price Alert</DialogTitle>
                <DialogDescription>Set up a notification for price changes</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Select Card</Label>
                  <Select value={selectedCardId} onValueChange={setSelectedCardId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a card" />
                    </SelectTrigger>
                    <SelectContent>
                      {cards.map(card => (
                        <SelectItem key={card.id} value={card.id}>
                          {card.card_name} {card.current_price_raw ? `($${card.current_price_raw})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Alert Type</Label>
                  <Select value={alertType} onValueChange={(v: any) => setAlertType(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="price_increase">Any Price Increase</SelectItem>
                      <SelectItem value="price_decrease">Any Price Decrease</SelectItem>
                      <SelectItem value="threshold">Price Threshold</SelectItem>
                      <SelectItem value="percentage_change">Percentage Change</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {alertType === "threshold" && (
                  <div>
                    <Label>Price Threshold ($)</Label>
                    <Input
                      type="number"
                      placeholder="e.g., 100"
                      value={thresholdValue}
                      onChange={(e) => setThresholdValue(e.target.value)}
                    />
                  </div>
                )}

                {alertType === "percentage_change" && (
                  <div>
                    <Label>Percentage Change (%)</Label>
                    <Input
                      type="number"
                      placeholder="e.g., 10"
                      value={percentageValue}
                      onChange={(e) => setPercentageValue(e.target.value)}
                    />
                  </div>
                )}

                <Button onClick={createAlert} className="w-full">Create Alert</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No price alerts set. Create one to get notified about price changes.
          </p>
        ) : (
          <div className="space-y-3">
            {alerts.map(alert => (
              <div key={alert.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3 flex-1">
                  {getAlertIcon(alert.alert_type)}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{getAlertDescription(alert)}</p>
                    {alert.card?.current_price_raw && (
                      <p className="text-xs text-muted-foreground">
                        Current: ${alert.card.current_price_raw}
                      </p>
                    )}
                  </div>
                  <Badge variant={alert.is_active ? "default" : "secondary"}>
                    {alert.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={alert.is_active}
                    onCheckedChange={(checked) => toggleAlert(alert.id, checked)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteAlert(alert.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}