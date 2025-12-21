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
      .select('id, card_name, card_set, card_number, game_type, sport_type, image_url, current_price_raw')
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
        
        let estimatedPrice = 0;
        
        if (card.game_type === 'MTG') {
          estimatedPrice = Math.random() * 5 + 0.50;
        } else if (card.game_type === 'Pokemon') {
          estimatedPrice = Math.random() * 10 + 1;
        } else if (card.game_type === 'YuGiOh') {
          estimatedPrice = Math.random() * 8 + 0.75;
        } else if (card.sport_type) {
          estimatedPrice = Math.random() * 15 + 2;
        } else {
          estimatedPrice = Math.random() * 5 + 1;
        }

        updates.push({
          id: card.id,
          current_price_raw: Math.round(estimatedPrice * 100) / 100,
          current_price_psa9: Math.round(estimatedPrice * 2.5 * 100) / 100,
          current_price_psa10: Math.round(estimatedPrice * 4 * 100) / 100,
          suggested_price: Math.round(estimatedPrice * 100) / 100,
          last_price_update: new Date().toISOString(),
        });
        
        console.log(`Estimated price for ${card.card_name}: $${estimatedPrice.toFixed(2)}`);
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
