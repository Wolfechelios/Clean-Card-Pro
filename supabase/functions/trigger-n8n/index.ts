import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type WorkflowType = 'price_alert' | 'daily_report' | 'ebay_watcher' | 'card_enrichment' | 'google_sheets_export' | 'social_share';

interface N8nTriggerRequest {
  workflow_type: WorkflowType;
  payload?: Record<string, unknown>;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the authorization header to identify the user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { workflow_type, payload } = await req.json() as N8nTriggerRequest;
    console.log(`Triggering n8n workflow: ${workflow_type} for user: ${user.id}`);

    // Get user's n8n webhook configuration
    const { data: config, error: configError } = await supabase
      .from('n8n_webhooks')
      .select('*')
      .eq('user_id', user.id)
      .eq('workflow_type', workflow_type)
      .eq('is_active', true)
      .maybeSingle();

    if (configError) {
      console.error('Config fetch error:', configError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch webhook configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!config || !config.webhook_url) {
      return new Response(
        JSON.stringify({ error: `No active webhook configured for ${workflow_type}`, configured: false }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare the payload with user context
    const enrichedPayload: Record<string, unknown> = {
      user_id: user.id,
      user_email: user.email,
      timestamp: new Date().toISOString(),
      workflow_type,
      ...payload,
    };

    // For specific workflow types, fetch additional data
    if (workflow_type === 'daily_report' || workflow_type === 'google_sheets_export') {
      // Fetch collection summary
      const { data: cards, error: cardsError } = await supabase
        .from('cards')
        .select('*')
        .eq('user_id', user.id);

      if (!cardsError && cards) {
        const totalValue = cards.reduce((sum: number, card: Record<string, unknown>) => 
          sum + (Number(card.suggested_price) || Number(card.current_price_raw) || 0), 0);
        enrichedPayload.collection_summary = {
          total_cards: cards.length,
          total_value: totalValue,
          cards: workflow_type === 'google_sheets_export' ? cards : cards.slice(0, 10),
        };
      }
    }

    if (workflow_type === 'price_alert') {
      // Fetch cards with significant price changes
      const { data: alerts } = await supabase
        .from('price_alerts')
        .select('*, cards(*)')
        .eq('user_id', user.id)
        .eq('is_active', true);

      enrichedPayload.active_alerts = alerts || [];
    }

    if (workflow_type === 'social_share' && payload?.card_id) {
      // Fetch specific card for sharing
      const { data: card } = await supabase
        .from('cards')
        .select('*')
        .eq('id', payload.card_id)
        .eq('user_id', user.id)
        .maybeSingle();

      enrichedPayload.card_details = card;
    }

    // Trigger the n8n webhook
    console.log(`Calling n8n webhook: ${config.webhook_url}`);
    
    await fetch(config.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(enrichedPayload),
    });

    // Log the trigger
    await supabase.from('n8n_webhook_logs').insert({
      user_id: user.id,
      webhook_id: config.id,
      workflow_type,
      payload: enrichedPayload,
      status: 'triggered',
    });

    console.log(`n8n webhook triggered successfully for ${workflow_type}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Workflow ${workflow_type} triggered successfully`,
        workflow_type,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error triggering n8n workflow:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to trigger workflow';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
