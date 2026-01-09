import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Optimized for speed - uses faster model and shorter prompt with built-in retry
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl } = await req.json();

    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log('Rapid card identification...');

    // Shorter, focused prompt for faster processing with better rarity detection
    const prompt = `Identify this trading card. Return JSON only:
{
  "card_name": "name",
  "card_set": "set name or null",
  "card_number": "number or null",
  "rarity": "REQUIRED - Common/Uncommon/Rare/Holo Rare/Ultra Rare/Secret Rare/Rookie Card/Refractor/Prizm/Parallel/Base/etc",
  "game_type": "Pokemon/MTG/YuGiOh/Sports or null",
  "sport_type": "sport type or null",
  "confidence": 0.0-1.0
}

RARITY RULES:
- Pokemon: Circle=Common, Diamond=Uncommon, Star=Rare, Star H=Holo Rare, Rainbow/Full Art=Secret Rare
- Yu-Gi-Oh: Check name color (silver=Rare, gold=Ultra Rare), holo pattern (Super/Secret/Ultimate/Ghost/Starlight)
- Sports: Base, RC (Rookie Card), Refractor, Prizm, Mosaic, Parallel, Auto, Numbered
- MTG: Black symbol=Common, Silver=Uncommon, Gold=Rare, Orange=Mythic Rare
- If holographic/prismatic/numbered - NOT Common
- NEVER return null for rarity

For Yu-Gi-Oh: use SET NUMBER format like LART-EN035 for card_number.
For sports: include player name in card_name.
JSON only.`;

    // Retry logic with exponential backoff for rate limits
    let lastError: Error | null = null;
    const maxRetries = 5;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite', // Fastest model
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: imageUrl } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;

          if (!content) {
            throw new Error('No AI response');
          }

          // Parse JSON response
          let cardData;
          try {
            const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/) || content.match(/```\n([\s\S]+?)\n```/) || content.match(/\{[\s\S]+\}/);
            const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
            cardData = JSON.parse(jsonStr.trim());
          } catch (e) {
            console.error('Parse error:', content);
            cardData = { card_name: 'Unknown Card', confidence: 0 };
          }

          console.log('Identified:', cardData.card_name);

          return new Response(
            JSON.stringify({ success: true, cardData }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Handle rate limits with retry
        if (response.status === 429) {
          const delay = Math.min(10000, 1000 * Math.pow(2, attempt));
          console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: 'Credits exhausted', success: false }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        throw new Error(`AI error: ${response.status}`);
      } catch (err) {
        lastError = err as Error;
        if (attempt < maxRetries - 1) {
          const delay = Math.min(10000, 1000 * Math.pow(2, attempt));
          console.log(`Error, retrying in ${delay}ms: ${err}`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // All retries exhausted
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded after retries', success: false }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '30' } }
    );

  } catch (error) {
    console.error('Rapid identify error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Error',
        success: false,
        cardData: { card_name: 'Unknown Card', confidence: 0 }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
