import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting: delay between cards
const DELAY_MS = 500;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { limit = 50 } = await req.json();
    const processLimit = Math.min(limit, 100); // Max 100 at a time

    console.log(`Resolving missing images for user ${user.id}, limit: ${processLimit}`);

    // Find cards with missing images
    const { data: cards, error: cardsError } = await supabase
      .from('cards')
      .select('id, card_name, card_set, set_code, card_number, year, variant, game_type, sport_type, player_name, image_locked, image_url')
      .eq('user_id', user.id)
      .eq('image_locked', false)
      .or('image_search_status.eq.missing,image_search_status.is.null,image_url.is.null,image_url.ilike.%placehold%')
      .limit(processLimit);

    if (cardsError) {
      throw new Error(`Failed to fetch cards: ${cardsError.message}`);
    }

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'No cards with missing images found',
        processed: 0,
        found: 0,
        not_found: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${cards.length} cards with missing images`);

    const results = {
      processed: 0,
      found: 0,
      not_found: 0,
      errors: 0,
      details: [] as Array<{ id: string; name: string; status: string; source?: string }>,
    };

    // Process cards sequentially with rate limiting
    for (const card of cards) {
      try {
        // Call resolve-card-image for each card
        const resolveUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/resolve-card-image`;
        const resolveResp = await fetch(resolveUrl, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ card_id: card.id }),
        });

        const resolveData = await resolveResp.json();
        results.processed++;

        if (resolveData.status === 'found' || resolveData.status === 'cached') {
          results.found++;
          results.details.push({
            id: card.id,
            name: card.card_name,
            status: 'found',
            source: resolveData.source,
          });
        } else {
          results.not_found++;
          results.details.push({
            id: card.id,
            name: card.card_name,
            status: resolveData.status || 'not_found',
          });
        }

        // Rate limiting delay
        if (results.processed < cards.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }

      } catch (error: any) {
        console.error(`Error processing card ${card.id}:`, error);
        results.errors++;
        results.details.push({
          id: card.id,
          name: card.card_name,
          status: 'error',
        });
      }
    }

    console.log(`Completed: ${results.found} found, ${results.not_found} not found, ${results.errors} errors`);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('resolve-missing-images error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
