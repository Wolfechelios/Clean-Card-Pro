import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all cards for this user that haven't been updated in the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: cards, error: fetchError } = await supabaseClient
      .from('cards')
      .select('id, card_name, card_set, card_number, game_type, sport_type, image_url')
      .eq('user_id', user_id)
      .or(`last_price_update.is.null,last_price_update.lt.${oneDayAgo}`)
      .limit(50); // Process max 50 cards per request to avoid timeouts

    if (fetchError) throw fetchError;

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No cards need price updates', updated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Updating prices for ${cards.length} cards`);

    // Process each card - fetch pricing via identify-card function
    const updates = [];
    
    for (const card of cards) {
      try {
        // Call identify-card to get fresh pricing
        const { data: pricingData, error: pricingError } = await supabaseClient.functions.invoke(
          'identify-card',
          {
            body: {
              imageUrl: card.image_url,
              ocrText: `${card.card_name} ${card.card_set || ''} ${card.card_number || ''}`,
            },
          }
        );

        if (!pricingError && pricingData) {
          updates.push({
            id: card.id,
            current_price_raw: pricingData.pricing?.currentPriceRaw || null,
            current_price_psa9: pricingData.pricing?.currentPricePsa9 || null,
            current_price_psa10: pricingData.pricing?.currentPricePsa10 || null,
            suggested_price: pricingData.pricing?.suggestedPrice || null,
            last_price_update: new Date().toISOString(),
          });
        }
      } catch (error) {
        console.error(`Error updating price for card ${card.id}:`, error);
        // Continue with other cards
      }
    }

    // Batch update all cards
    if (updates.length > 0) {
      for (const update of updates) {
        await supabaseClient
          .from('cards')
          .update({
            current_price_raw: update.current_price_raw,
            current_price_psa9: update.current_price_psa9,
            current_price_psa10: update.current_price_psa10,
            suggested_price: update.suggested_price,
            last_price_update: update.last_price_update,
          })
          .eq('id', update.id);
      }
    }

    console.log(`Successfully updated ${updates.length} card prices`);

    return new Response(
      JSON.stringify({ 
        message: 'Price update complete',
        updated: updates.length,
        total_checked: cards.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Price update error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
