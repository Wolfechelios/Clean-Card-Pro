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

async function searchSportsCardWithAI(cardName: string, cardSet: string | null, gameType: string | null): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return null;

  try {
    // Build a detailed search query for sports cards
    const searchTerms = [cardName];
    if (cardSet) searchTerms.push(cardSet);
    if (gameType) searchTerms.push(gameType);
    searchTerms.push('trading card');
    
    const searchQuery = searchTerms.join(' ');
    
    const prompt = `You are helping find a real image URL for a sports trading card.

Card details:
- Name: ${cardName}
- Set/Year: ${cardSet || 'Unknown'}
- Type: ${gameType || 'Sports card'}

Search for this exact card image using Google Image Search. Look for images from these trusted sources:
1. eBay listings (i.ebayimg.com)
2. COMC (comc.com)
3. Beckett (beckett.com)
4. PSA (psacard.com)
5. Sports card databases

Return ONLY a direct image URL (must start with https:// and end with .jpg, .jpeg, .png, or .webp).
The URL must be a direct link to the image file, not a webpage.

If you cannot find a valid direct image URL, respond with exactly: NONE

Important: Only return URLs from legitimate card selling/grading sites. Do not make up URLs.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { 
            role: "system", 
            content: "You are a sports card image finder. You search Google Images and return direct image URLs from legitimate card selling sites. Only return real, working image URLs. Never fabricate URLs."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      
      console.log('AI sports card search response:', content);
      
      if (content && content !== "NONE" && content.startsWith('https://')) {
        // Extract URL if embedded in text
        const urlMatch = content.match(/https:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)/i);
        if (urlMatch) {
          const imageUrl = urlMatch[0];
          console.log('Found sports card image URL:', imageUrl);
          
          // Validate the URL actually returns a valid image
          try {
            const validateResp = await fetch(imageUrl, { method: 'HEAD' });
            if (validateResp.ok) {
              const contentType = validateResp.headers.get('content-type') || '';
              const contentLength = validateResp.headers.get('content-length');
              
              // Check if it's an image and reasonably sized (> 5KB)
              if (contentType.includes('image/') && (!contentLength || parseInt(contentLength) > 5000)) {
                return imageUrl;
              } else {
                console.log('Sports card URL failed validation - not a valid image or too small');
              }
            }
          } catch (validateError) {
            console.log('Sports card URL validation failed:', validateError);
          }
        }
      }
    }
  } catch (error) {
    console.log('AI sports card search failed:', error);
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
        try {
          new URL(content);
          if (/\.(jpg|jpeg|png|webp|gif)/i.test(content)) {
            // Validate the URL actually returns a valid image
            try {
              const validateResp = await fetch(content, { method: 'HEAD' });
              if (validateResp.ok) {
                const contentType = validateResp.headers.get('content-type') || '';
                const contentLength = validateResp.headers.get('content-length');
                
                // Check if it's an image and reasonably sized (> 5KB)
                if (contentType.includes('image/') && (!contentLength || parseInt(contentLength) > 5000)) {
                  return content;
                } else {
                  console.log('AI URL failed validation - not a valid image or too small');
                }
              }
            } catch (validateError) {
              console.log('AI URL validation failed:', validateError);
            }
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
    const isSportsCard = gameTypeLower.includes('sports') || 
                         gameTypeLower.includes('football') || 
                         gameTypeLower.includes('baseball') || 
                         gameTypeLower.includes('basketball') || 
                         gameTypeLower.includes('hockey') ||
                         gameTypeLower.includes('soccer') ||
                         !gameTypeLower.includes('pokemon') && 
                         !gameTypeLower.includes('pokémon') && 
                         !gameTypeLower.includes('magic') && 
                         !gameTypeLower.includes('mtg') &&
                         !gameTypeLower.includes('yugioh') &&
                         !gameTypeLower.includes('yu-gi-oh');

    // Try game-specific APIs first
    if (gameTypeLower.includes('pokemon') || gameTypeLower.includes('pokémon')) {
      imageUrl = await searchPokemonTCG(cardName, cardSet);
      console.log('Pokemon TCG result:', imageUrl ? 'found' : 'not found');
    }

    if (!imageUrl && (gameTypeLower.includes('magic') || gameTypeLower.includes('mtg'))) {
      imageUrl = await searchScryfall(cardName, cardSet);
      console.log('Scryfall result:', imageUrl ? 'found' : 'not found');
    }

    // For sports cards, try AI-powered Google Image search first
    if (!imageUrl && isSportsCard) {
      console.log('Detected sports card, using AI Google Image search...');
      imageUrl = await searchSportsCardWithAI(cardName, cardSet, gameType);
      console.log('AI sports card search result:', imageUrl ? 'found' : 'not found');
    }

    // Try Scryfall for any card if not found yet (works for many TCGs)
    if (!imageUrl && !isSportsCard) {
      imageUrl = await searchScryfall(cardName, cardSet);
      console.log('Scryfall fallback result:', imageUrl ? 'found' : 'not found');
    }

    // Try Pokemon TCG as fallback for non-sports cards
    if (!imageUrl && !isSportsCard) {
      imageUrl = await searchPokemonTCG(cardName, cardSet);
      console.log('Pokemon TCG fallback result:', imageUrl ? 'found' : 'not found');
    }

    // Try general AI as last resort
    if (!imageUrl) {
      imageUrl = await searchWithAI(cardName, cardSet, gameType);
      console.log('AI general search result:', imageUrl ? 'found' : 'not found');
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
