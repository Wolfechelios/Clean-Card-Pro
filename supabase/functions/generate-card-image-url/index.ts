import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Known card image sources
const SCRYFALL_API = 'https://api.scryfall.com/cards/named';
const POKEMON_TCG_API = 'https://api.pokemontcg.io/v2/cards';

async function searchScryfall(cardName: string, cardSet?: string): Promise<string | null> {
  try {
    const query = cardSet 
      ? `${cardName} set:${cardSet}`
      : cardName;
    
    const response = await fetch(`${SCRYFALL_API}?fuzzy=${encodeURIComponent(cardName)}`);
    if (response.ok) {
      const data = await response.json();
      // Prefer large image, fallback to normal
      return data.image_uris?.large || data.image_uris?.normal || data.image_uris?.small || null;
    }
  } catch (error) {
    console.log('Scryfall search failed:', error);
  }
  return null;
}

async function searchPokemonTCG(cardName: string, cardSet?: string): Promise<string | null> {
  try {
    let query = `name:"${cardName}"`;
    if (cardSet) {
      query += ` set.name:"${cardSet}"`;
    }
    
    const response = await fetch(`${POKEMON_TCG_API}?q=${encodeURIComponent(query)}&pageSize=1`);
    if (response.ok) {
      const data = await response.json();
      if (data.data && data.data.length > 0) {
        return data.data[0].images?.large || data.data[0].images?.small || null;
      }
    }
  } catch (error) {
    console.log('Pokemon TCG search failed:', error);
  }
  return null;
}

async function searchWithAI(cardName: string, cardSet: string | null, gameType: string | null): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return null;

  try {
    const prompt = `Find a direct image URL for this trading card from tcgplayer.com, cardmarket.com, or ebay.com:

Card: ${cardName}
Set: ${cardSet || 'Unknown'}
Game: ${gameType || 'Unknown'}

Return ONLY a valid https:// image URL ending in .jpg, .png, or .webp. If not found, respond with "NONE".`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      
      if (content && content !== "NONE" && content.startsWith('https://')) {
        // Validate URL format
        try {
          new URL(content);
          // Check if it looks like an image URL
          if (/\.(jpg|jpeg|png|webp|gif)/i.test(content)) {
            return content;
          }
        } catch {
          // Invalid URL
        }
      }
    }
  } catch (error) {
    console.log('AI search failed:', error);
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cardName, cardSet, gameType } = await req.json();

    if (!cardName) {
      return new Response(
        JSON.stringify({ error: 'cardName is required', imageUrl: null }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Looking up image for: ${cardName}, set: ${cardSet}, type: ${gameType}`);

    let imageUrl: string | null = null;
    const gameTypeLower = (gameType || '').toLowerCase();

    // Try game-specific APIs first
    if (gameTypeLower.includes('pokemon') || gameTypeLower.includes('pokémon')) {
      imageUrl = await searchPokemonTCG(cardName, cardSet);
      console.log('Pokemon TCG result:', imageUrl ? 'found' : 'not found');
    }

    if (!imageUrl && (gameTypeLower.includes('magic') || gameTypeLower.includes('mtg'))) {
      imageUrl = await searchScryfall(cardName, cardSet);
      console.log('Scryfall result:', imageUrl ? 'found' : 'not found');
    }

    // Try Scryfall for any card if not found yet (works for many TCGs)
    if (!imageUrl) {
      imageUrl = await searchScryfall(cardName, cardSet);
      console.log('Scryfall fallback result:', imageUrl ? 'found' : 'not found');
    }

    // Try Pokemon TCG as fallback
    if (!imageUrl) {
      imageUrl = await searchPokemonTCG(cardName, cardSet);
      console.log('Pokemon TCG fallback result:', imageUrl ? 'found' : 'not found');
    }

    // Try AI as last resort
    if (!imageUrl) {
      imageUrl = await searchWithAI(cardName, cardSet, gameType);
      console.log('AI search result:', imageUrl ? 'found' : 'not found');
    }

    if (imageUrl) {
      return new Response(
        JSON.stringify({ imageUrl, found: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No image found - return null instead of placeholder
    return new Response(
      JSON.stringify({ imageUrl: null, found: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('generate-card-image-url error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Error', imageUrl: null }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
