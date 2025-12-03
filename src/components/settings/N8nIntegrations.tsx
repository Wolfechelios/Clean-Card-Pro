import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { 
  Zap, 
  Bell, 
  Mail, 
  Search, 
  FileSpreadsheet, 
  Share2, 
  Sparkles,
  Loader2,
  Check,
  ExternalLink
} from "lucide-react";

type WorkflowType = 'price_alert' | 'daily_report' | 'ebay_watcher' | 'card_enrichment' | 'google_sheets_export' | 'social_share';

interface WebhookConfig {
  id?: string;
  workflow_type: WorkflowType;
  webhook_url: string;
  webhook_name: string;
  is_active: boolean;
}

const WORKFLOW_CONFIGS: { type: WorkflowType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    type: 'price_alert',
    label: 'Price Alert Automation',
    description: 'Get notified when card prices hit your thresholds via email/SMS/Discord',
    icon: <Bell className="h-5 w-5 text-yellow-500" />,
  },
  {
    type: 'daily_report',
    label: 'Daily Collection Report',
    description: 'Receive automated daily/weekly email summaries of your collection value',
    icon: <Mail className="h-5 w-5 text-blue-500" />,
  },
  {
    type: 'ebay_watcher',
    label: 'eBay Listing Watcher',
    description: 'Monitor eBay for new listings matching cards in your collection',
    icon: <Search className="h-5 w-5 text-green-500" />,
  },
  {
    type: 'card_enrichment',
    label: 'Card Data Enrichment',
    description: 'Pull additional card data from external APIs (TCGPlayer, Scryfall, etc.)',
    icon: <Sparkles className="h-5 w-5 text-purple-500" />,
  },
  {
    type: 'google_sheets_export',
    label: 'Google Sheets Export',
    description: 'Auto-sync your collection to a Google Sheet for backup/analysis',
    icon: <FileSpreadsheet className="h-5 w-5 text-emerald-500" />,
  },
  {
    type: 'social_share',
    label: 'Social Sharing',
    description: 'Auto-post high-value card pulls to Twitter/Discord',
    icon: <Share2 className="h-5 w-5 text-pink-500" />,
  },
];

export default function N8nIntegrations() {
  const [webhooks, setWebhooks] = useState<Record<WorkflowType, WebhookConfig>>(() => {
    const initial: Record<WorkflowType, WebhookConfig> = {} as Record<WorkflowType, WebhookConfig>;
    WORKFLOW_CONFIGS.forEach(config => {
      initial[config.type] = {
        workflow_type: config.type,
        webhook_url: '',
        webhook_name: config.label,
        is_active: false,
      };
    });
    return initial;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<WorkflowType | null>(null);
  const [testing, setTesting] = useState<WorkflowType | null>(null);

  useEffect(() => {
    loadWebhooks();
  }, []);

  const loadWebhooks = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('n8n_webhooks')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;

      if (data) {
        const updated = { ...webhooks };
        data.forEach((webhook: any) => {
          if (updated[webhook.workflow_type as WorkflowType]) {
            updated[webhook.workflow_type as WorkflowType] = {
              id: webhook.id,
              workflow_type: webhook.workflow_type,
              webhook_url: webhook.webhook_url,
              webhook_name: webhook.webhook_name || '',
              is_active: webhook.is_active,
            };
          }
        });
        setWebhooks(updated);
      }
    } catch (error) {
      console.error('Error loading webhooks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (type: WorkflowType) => {
    setSaving(type);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('You must be logged in');
        return;
      }

      const config = webhooks[type];
      
      if (config.id) {
        // Update existing
        const { error } = await supabase
          .from('n8n_webhooks')
          .update({
            webhook_url: config.webhook_url,
            webhook_name: config.webhook_name,
            is_active: config.is_active,
          })
          .eq('id', config.id);

        if (error) throw error;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('n8n_webhooks')
          .insert({
            user_id: user.id,
            workflow_type: type,
            webhook_url: config.webhook_url,
            webhook_name: config.webhook_name,
            is_active: config.is_active,
          })
          .select()
          .single();

        if (error) throw error;
        
        setWebhooks(prev => ({
          ...prev,
          [type]: { ...prev[type], id: data.id },
        }));
      }

      toast.success('Webhook saved successfully');
    } catch (error) {
      console.error('Error saving webhook:', error);
      toast.error('Failed to save webhook');
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (type: WorkflowType) => {
    setTesting(type);
    try {
      const { data, error } = await supabase.functions.invoke('trigger-n8n', {
        body: { workflow_type: type },
      });

      if (error) throw error;

      if (data?.configured === false) {
        toast.error(`No webhook configured for ${WORKFLOW_CONFIGS.find(c => c.type === type)?.label}`);
      } else {
        toast.success('Test webhook triggered! Check your n8n workflow.');
      }
    } catch (error: any) {
      console.error('Error testing webhook:', error);
      toast.error(error.message || 'Failed to trigger test');
    } finally {
      setTesting(null);
    }
  };

  const updateConfig = (type: WorkflowType, field: keyof WebhookConfig, value: string | boolean) => {
    setWebhooks(prev => ({
      ...prev,
      [type]: { ...prev[type], [field]: value },
    }));
  };

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-orange-500" />
          n8n Workflow Automations
        </CardTitle>
        <CardDescription>
          Connect your n8n workflows to automate tasks like price alerts, reports, and more.
          <a 
            href="https://n8n.io" 
            target="_blank" 
            rel="noopener noreferrer"
            className="ml-1 text-primary hover:underline inline-flex items-center gap-1"
          >
            Learn more about n8n <ExternalLink className="h-3 w-3" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {WORKFLOW_CONFIGS.map(config => {
          const webhook = webhooks[config.type];
          const isConfigured = !!webhook.webhook_url && webhook.is_active;

          return (
            <div key={config.type} className="border border-border rounded-lg p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {config.icon}
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-foreground">{config.label}</h4>
                      {isConfigured && (
                        <Badge variant="secondary" className="text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{config.description}</p>
                  </div>
                </div>
                <Switch
                  checked={webhook.is_active}
                  onCheckedChange={(checked) => updateConfig(config.type, 'is_active', checked)}
                />
              </div>

              <div className="space-y-3 pl-8">
                <div className="space-y-2">
                  <Label htmlFor={`${config.type}-url`} className="text-sm">
                    Webhook URL
                  </Label>
                  <Input
                    id={`${config.type}-url`}
                    type="url"
                    placeholder="https://your-n8n-instance.com/webhook/..."
                    value={webhook.webhook_url}
                    onChange={(e) => updateConfig(config.type, 'webhook_url', e.target.value)}
                    className="bg-background"
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleSave(config.type)}
                    disabled={saving === config.type || !webhook.webhook_url}
                  >
                    {saving === config.type ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : null}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTest(config.type)}
                    disabled={testing === config.type || !webhook.webhook_url || !webhook.is_active}
                  >
                    {testing === config.type ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : null}
                    Test
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
          <h5 className="font-medium text-foreground mb-2">How to set up n8n webhooks:</h5>
          <ol className="list-decimal list-inside space-y-1">
            <li>Create a new workflow in your n8n instance</li>
            <li>Add a "Webhook" trigger node</li>
            <li>Copy the webhook URL and paste it above</li>
            <li>Enable the workflow and toggle it active here</li>
            <li>Click "Test" to verify the connection</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
