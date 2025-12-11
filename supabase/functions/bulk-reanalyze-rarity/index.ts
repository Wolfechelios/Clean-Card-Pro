import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { batchSize = 10, offset = 0 } = await req.json().catch(() => ({}));

    console.log(`Fetching cards with null rarity for user ${user.id}, offset: ${offset}, batchSize: ${batchSize}`);

    // Fetch cards with null rarity for this user
    const { data: cards, error: fetchError, count } = await supabase
      .from('cards')
      .select('id, image_url, card_name', { count: 'exact' })
      .eq('user_id', user.id)
      .is('rarity', null)
      .range(offset, offset + batchSize - 1);

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      throw fetchError;
    }

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        processed: 0, 
        remaining: 0,
        message: 'No cards with null rarity found' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${cards.length} cards to process, total remaining: ${count}`);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const results: { id: string; rarity: string | null; success: boolean }[] = [];

    // Process cards in parallel with concurrency limit
    const processCard = async (card: { id: string; image_url: string; card_name: string }) => {
      try {
        const prompt = `Identify the RARITY of this trading card. Return JSON only:
{
  "rarity": "REQUIRED - Common/Uncommon/Rare/Holo Rare/Ultra Rare/Secret Rare/Rookie Card/RC/Refractor/Prizm/Parallel/Base/Super Rare/Mythic Rare/etc",
  "confidence": 0.0-1.0
}

RARITY RULES:
- Pokemon: Circle=Common, Diamond=Uncommon, Star=Rare, Star H=Holo Rare, Rainbow/Full Art=Secret Rare
- Yu-Gi-Oh: Check name color (silver=Rare, gold=Ultra Rare), holo pattern (Super/Secret/Ultimate/Ghost/Starlight)
- Sports: Base, RC (Rookie Card), Refractor, Prizm, Mosaic, Parallel, Auto, Numbered
- MTG: Black symbol=Common, Silver=Uncommon, Gold=Rare, Orange=Mythic Rare
- If holographic/prismatic/numbered - NOT Common
- NEVER return null for rarity - always make your best determination

JSON only.`;

        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite',
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: card.image_url } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 200,
          }),
        });

        if (!response.ok) {
          console.error(`AI error for card ${card.id}: ${response.status}`);
          return { id: card.id, rarity: null, success: false };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
          return { id: card.id, rarity: null, success: false };
        }

        // Parse JSON response
        let rarityData;
        try {
          const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/) || content.match(/\{[\s\S]+\}/);
          const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
          rarityData = JSON.parse(jsonStr.trim());
        } catch (e) {
          console.error(`Parse error for card ${card.id}:`, content);
          return { id: card.id, rarity: null, success: false };
        }

        const rarity = rarityData.rarity;
        if (rarity && rarity !== 'null' && rarity !== 'unknown') {
          // Update the card in database
          const { error: updateError } = await supabase
            .from('cards')
            .update({ rarity })
            .eq('id', card.id)
            .eq('user_id', user.id);

          if (updateError) {
            console.error(`Update error for card ${card.id}:`, updateError);
            return { id: card.id, rarity: null, success: false };
          }

          console.log(`Updated card ${card.id} with rarity: ${rarity}`);
          return { id: card.id, rarity, success: true };
        }

        return { id: card.id, rarity: null, success: false };
      } catch (error) {
        console.error(`Error processing card ${card.id}:`, error);
        return { id: card.id, rarity: null, success: false };
      }
    };

    // Process in batches of 5 concurrent requests
    const concurrencyLimit = 5;
    for (let i = 0; i < cards.length; i += concurrencyLimit) {
      const batch = cards.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(batch.map(processCard));
      results.push(...batchResults);
    }

    const successCount = results.filter(r => r.success).length;
    const remaining = (count || 0) - batchSize;

    console.log(`Processed ${results.length} cards, ${successCount} successful, ${remaining} remaining`);

    return new Response(JSON.stringify({ 
      success: true, 
      processed: results.length,
      updated: successCount,
      remaining: Math.max(0, remaining),
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Bulk reanalyze error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
