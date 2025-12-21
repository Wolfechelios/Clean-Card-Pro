

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Known card image sources
const SCRYFALL_API = 'https://api.scryfall.com/cards/named';
const POKEMON_TCG_API = 'https://api.pokemontcg.io/v2/cards';

async function searchScryfall(cardName: string, cardSet?: string): Promise<string | null> {
  try {
    const response = await fetch(`${SCRYFALL_API}?fuzzy=${encodeURIComponent(cardName)}`);
    if (response.ok) {
      const data = await response.json();
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

// Use Perplexity to search the web for card images
async function searchWithPerplexity(cardName: string, cardSet: string | null, gameType: string | null): Promise<string | null> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY) {
    console.log('PERPLEXITY_API_KEY not configured');
    return null;
  }

  try {
    const searchQuery = [
      cardName,
      cardSet,
      gameType,
      'trading card image'
    ].filter(Boolean).join(' ');

    console.log('Perplexity search query:', searchQuery);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { 
            role: 'system', 
            content: `You are a trading card image URL finder. Search for the exact card image.
Return ONLY a direct image URL (https:// ending in .jpg, .jpeg, .png, or .webp).
Priority sources: sportscardpro.com, tcgplayer.com, cardmarket.com, pricecharting.com
If no direct image URL found, respond with exactly: NONE
Never fabricate URLs - only return URLs you find in search results.` 
          },
          { 
            role: 'user', 
            content: `Find a direct image URL for this trading card: ${cardName}${cardSet ? ` from set "${cardSet}"` : ''}${gameType ? ` (${gameType})` : ''}`
          }
        ],
        search_domain_filter: [
          'sportscardpro.com',
          'tcgplayer.com', 
          'cardmarket.com',
          'pricecharting.com',
          'ebay.com',
          'comc.com'
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Perplexity API error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    const citations = data.citations || [];
    
    console.log('Perplexity response:', content);
    console.log('Perplexity citations:', citations);

    // Try to extract image URL from response
    if (content && content !== "NONE") {
      const urlMatch = content.match(/https:\/\/[^\s"'<>\]]+\.(jpg|jpeg|png|webp)/i);
      if (urlMatch) {
        const imageUrl = urlMatch[0];
        console.log('Found image URL from Perplexity:', imageUrl);
        
        // Trust URLs from known reliable sources without validation
        // (validation causes DNS issues in edge function environment)
        if (isKnownImageSource(imageUrl)) {
          return imageUrl;
        }
        
        // For unknown sources, do a quick validation with timeout
        const isValid = await validateImageUrlSafe(imageUrl);
        if (isValid) {
          return imageUrl;
        }
      }
    }

    // Try to find images from citations
    for (const citation of citations) {
      if (typeof citation === 'string') {
        // Check if citation itself is an image URL
        if (/\.(jpg|jpeg|png|webp)$/i.test(citation)) {
          if (isKnownImageSource(citation)) {
            console.log('Found trusted image in citations:', citation);
            return citation;
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Perplexity search failed:', error);
    return null;
  }
}

// Known trusted image sources that don't need validation
function isKnownImageSource(url: string): boolean {
  const trustedDomains = [
    'sportscardpro.com',
    'tcgplayer.com',
    'images.tcgplayer.com',
    'cardmarket.com',
    'pricecharting.com',
    'images.pricecharting.com',
    'ebay.com',
    'i.ebayimg.com',
    'comc.com',
    'product-images.tcgplayer.com',
    'cdn.tcgplayer.com',
    'assets.tcgplayer.com',
    'pokemontcg.io',
    'images.pokemontcg.io',
    'scryfall.io',
    'cards.scryfall.io',
    'ygoprodeck.com',
    'images.ygoprodeck.com',
  ];
  
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return trustedDomains.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

// Safe validation with timeout - returns true on timeout to avoid blocking
async function validateImageUrlSafe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
  
  try {
    const response = await fetch(url, { 
      method: 'HEAD',
      signal: controller.signal 
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) return false;
    
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('image/');
  } catch (error: any) {
    clearTimeout(timeoutId);
    // If it's a network/DNS error or timeout, still return true for known image extensions
    // The attach-image function will do final validation when downloading
    if (url.match(/\.(jpg|jpeg|png|webp)$/i)) {
      console.log('Validation skipped due to network issue, trusting URL format:', url);
      return true;
    }
    console.log('URL validation failed:', error.message || error);
    return false;
  }
}

Deno.serve(async (req) => {
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
    
    const isPokemon = gameTypeLower.includes('pokemon') || gameTypeLower.includes('pokémon');
    const isMTG = gameTypeLower.includes('magic') || gameTypeLower.includes('mtg');

    // Try game-specific APIs first (they're free and reliable)
    if (isPokemon) {
      imageUrl = await searchPokemonTCG(cardName, cardSet);
      console.log('Pokemon TCG result:', imageUrl ? 'found' : 'not found');
    }

    if (!imageUrl && isMTG) {
      imageUrl = await searchScryfall(cardName, cardSet);
      console.log('Scryfall result:', imageUrl ? 'found' : 'not found');
    }

    // For non-TCG cards or if TCG APIs fail, use Perplexity web search
    if (!imageUrl) {
      console.log('Using Perplexity web search...');
      imageUrl = await searchWithPerplexity(cardName, cardSet, gameType);
      console.log('Perplexity result:', imageUrl ? 'found' : 'not found');
    }

    // Fallback: try Scryfall/Pokemon for unknown card types
    if (!imageUrl && !isPokemon && !isMTG) {
      imageUrl = await searchScryfall(cardName, cardSet);
      if (!imageUrl) {
        imageUrl = await searchPokemonTCG(cardName, cardSet);
      }
    }

    if (imageUrl) {
      return new Response(
        JSON.stringify({ imageUrl, found: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
