import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract and verify JWT token from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Create client with anon key to verify the user's token
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Get the authenticated user from the token
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log(`Authenticated user: ${userId}`);

    // Use service role client for database operations
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get all cards for this user that need price updates:
    // - Cards with null prices regardless of last update
    // - Cards not updated in the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: cards, error: fetchError } = await supabaseClient
      .from('cards')
      .select('id, card_name, card_set, card_number, game_type, sport_type, condition, image_url, current_price_raw')
      .eq('user_id', userId)
      .or(`current_price_raw.is.null,last_price_update.is.null,last_price_update.lt.${oneDayAgo}`)
      .limit(50);

    if (fetchError) throw fetchError;

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No cards need price updates', updated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Updating prices for ${cards.length} cards`);

    const updates = [];
    
    for (const card of cards) {
      try {
        console.log(`Processing: ${card.card_name}`);
        
        // Call the real fetch-card-prices function
        const priceResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/fetch-card-prices`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
            },
            body: JSON.stringify({
              cardName: card.card_name,
              cardSet: card.card_set,
              cardNumber: card.card_number,
              gameType: card.game_type,
              sportType: card.sport_type,
            }),
          }
        );

        if (!priceResponse.ok) {
          console.error(`Price fetch failed for ${card.card_name}: ${priceResponse.status}`);
          continue;
        }

        const priceData = await priceResponse.json();
        
        updates.push({
          id: card.id,
          current_price_raw: priceData.raw ?? null,
          current_price_psa9: priceData.psa9 ?? null,
          current_price_psa10: priceData.psa10 ?? null,
          suggested_price: priceData.suggested ?? priceData.raw ?? null,
          last_price_update: new Date().toISOString(),
        });
        
        console.log(`Real price for ${card.card_name}: $${priceData.raw ?? 'N/A'} (source: ${priceData.source})`);
      } catch (error) {
        console.error(`Error updating price for card ${card.id}:`, error);
      }
    }

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
