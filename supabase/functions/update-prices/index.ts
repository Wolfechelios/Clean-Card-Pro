import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log(`Authenticated user: ${userId}`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: cards, error: fetchError } = await supabaseClient
      .from('cards')
      .select('id, card_name, card_set, card_number, game_type, sport_type, condition, image_url, current_price_raw')
      .eq('user_id', userId)
      .or(`current_price_raw.is.null,last_price_update.is.null,last_price_update.lt.${oneDayAgo}`)
      .limit(20);

    if (fetchError) throw fetchError;

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No cards need price updates', updated: 0, skipped: 0, remaining: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Count total remaining for the response
    const { count: totalRemaining } = await supabaseClient
      .from('cards')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .or(`current_price_raw.is.null,last_price_update.is.null,last_price_update.lt.${oneDayAgo}`);

    console.log(`Updating prices for ${cards.length} cards (${totalRemaining} total remaining)`);

    const updates = [];
    let skipped = 0;
    let consecutiveRateLimits = 0;

    for (const card of cards) {
      // Stop if we hit 3 consecutive rate limits
      if (consecutiveRateLimits >= 3) {
        console.log('3 consecutive rate limits — stopping early');
        skipped += 1;
        continue;
      }

      try {
        console.log(`Processing: ${card.card_name}`);

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
              condition: card.condition,
            }),
          }
        );

        // Handle rate limits with retry
        if (priceResponse.status === 429) {
          const retryAfter = parseInt(priceResponse.headers.get('Retry-After') || '10', 10);
          const waitMs = Math.min(retryAfter * 1000, 35000);
          console.log(`Rate limited — waiting ${waitMs}ms then retrying ${card.card_name}`);
          await priceResponse.text(); // consume body
          await sleep(waitMs);
          consecutiveRateLimits++;

          // Retry once
          const retryResponse = await fetch(
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
                condition: card.condition,
              }),
            }
          );

          if (!retryResponse.ok) {
            console.error(`Retry failed for ${card.card_name}: ${retryResponse.status}`);
            await retryResponse.text();
            skipped++;
            continue;
          }

          const retryData = await retryResponse.json();
          updates.push({
            id: card.id,
            current_price_raw: retryData.raw ?? null,
            current_price_psa9: retryData.psa9 ?? null,
            current_price_psa10: retryData.psa10 ?? null,
            suggested_price: retryData.suggested ?? retryData.raw ?? null,
            last_price_update: new Date().toISOString(),
          });
          consecutiveRateLimits = 0;
          console.log(`Retry succeeded for ${card.card_name}: $${retryData.raw ?? 'N/A'}`);
        } else if (!priceResponse.ok) {
          const body = await priceResponse.text();
          // Check for rate limit error in body
          if (/rate.?limit|429|too many/i.test(body)) {
            consecutiveRateLimits++;
            console.error(`Rate limit in body for ${card.card_name}`);
          } else {
            consecutiveRateLimits = 0;
            console.error(`Price fetch failed for ${card.card_name}: ${priceResponse.status}`);
          }
          skipped++;
        } else {
          consecutiveRateLimits = 0;
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
        }
      } catch (error) {
        console.error(`Error updating price for card ${card.id}:`, error);
        skipped++;
      }

      // 2-second delay between cards to avoid rate limits
      await sleep(2000);
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

    const remaining = (totalRemaining ?? 0) - updates.length;
    console.log(`Updated ${updates.length}, skipped ${skipped}, ~${remaining} remaining`);

    return new Response(
      JSON.stringify({
        message: 'Price update complete',
        updated: updates.length,
        skipped,
        total_checked: cards.length,
        remaining: Math.max(0, remaining),
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
