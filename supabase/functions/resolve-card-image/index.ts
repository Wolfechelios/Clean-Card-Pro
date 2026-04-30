import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAIGateway } from "../_shared/aiGateway.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateImageUrl, SSRFError } from "../_shared/validateUrl.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// API endpoints
const SCRYFALL_API = 'https://api.scryfall.com';
const POKEMON_TCG_API = 'https://api.pokemontcg.io/v2/cards';
const YGOPRODECK_API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';

interface CardData {
  id: string;
  card_name: string;
  card_set: string | null;
  set_code: string | null;
  card_number: string | null;
  year: number | null;
  variant: string | null;
  game_type: string | null;
  sport_type: string | null;
  player_name: string | null;
  image_locked: boolean;
}

interface ResolveResult {
  imageUrl: string | null;
  source: string | null;
  status: 'found' | 'not_found' | 'error' | 'locked';
  error?: string;
}

// MTG: Scryfall resolver
async function resolveMTG(card: CardData): Promise<ResolveResult> {
  try {
    // Method 1: Use set code + collector number if available
    if (card.set_code && card.card_number) {
      const cleanNumber = card.card_number.replace(/^#/, '').trim();
      const url = `${SCRYFALL_API}/cards/${card.set_code.toLowerCase()}/${cleanNumber}`;
      console.log(`MTG lookup by set/number: ${url}`);
      
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const imageUrl = data.image_uris?.large || data.image_uris?.normal || 
                        (data.card_faces?.[0]?.image_uris?.large) || null;
        if (imageUrl) {
          return { imageUrl, source: 'scryfall', status: 'found' };
        }
      }
    }

    // Method 2: Named search
    const namedUrl = `${SCRYFALL_API}/cards/named?fuzzy=${encodeURIComponent(card.card_name)}`;
    console.log(`MTG named search: ${namedUrl}`);
    
    const namedResp = await fetch(namedUrl);
    if (namedResp.ok) {
      const data = await namedResp.json();
      const imageUrl = data.image_uris?.large || data.image_uris?.normal || 
                      (data.card_faces?.[0]?.image_uris?.large) || null;
      if (imageUrl) {
        return { imageUrl, source: 'scryfall', status: 'found' };
      }
    }

    // Method 3: Search with set filter
    if (card.card_set) {
      const searchUrl = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(card.card_name)}+set:${encodeURIComponent(card.card_set)}`;
      const searchResp = await fetch(searchUrl);
      if (searchResp.ok) {
        const data = await searchResp.json();
        if (data.data?.[0]) {
          const imageUrl = data.data[0].image_uris?.large || data.data[0].image_uris?.normal || null;
          if (imageUrl) {
            return { imageUrl, source: 'scryfall', status: 'found' };
          }
        }
      }
    }

    return { imageUrl: null, source: null, status: 'not_found' };
  } catch (error: any) {
    console.error('MTG resolve error:', error);
    return { imageUrl: null, source: null, status: 'error', error: error.message };
  }
}

// Pokemon: pokemontcg.io resolver
async function resolvePokemon(card: CardData): Promise<ResolveResult> {
  try {
    let query = `name:"${card.card_name}"`;
    
    if (card.set_code) {
      query += ` set.id:${card.set_code}`;
    } else if (card.card_set) {
      query += ` set.name:"${card.card_set}"`;
    }
    
    if (card.card_number) {
      const cleanNumber = card.card_number.replace(/^#/, '').trim();
      query += ` number:${cleanNumber}`;
    }

    const url = `${POKEMON_TCG_API}?q=${encodeURIComponent(query)}&pageSize=1`;
    console.log(`Pokemon lookup: ${url}`);
    
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json();
      if (data.data?.[0]?.images?.large) {
        return { imageUrl: data.data[0].images.large, source: 'pokemontcg', status: 'found' };
      }
    }

    // Fallback: name only search
    const fallbackUrl = `${POKEMON_TCG_API}?q=name:"${encodeURIComponent(card.card_name)}"&pageSize=1`;
    const fallbackResp = await fetch(fallbackUrl);
    if (fallbackResp.ok) {
      const data = await fallbackResp.json();
      if (data.data?.[0]?.images?.large) {
        return { imageUrl: data.data[0].images.large, source: 'pokemontcg', status: 'found' };
      }
    }

    return { imageUrl: null, source: null, status: 'not_found' };
  } catch (error: any) {
    console.error('Pokemon resolve error:', error);
    return { imageUrl: null, source: null, status: 'error', error: error.message };
  }
}

// Yu-Gi-Oh: YGOPRODeck resolver
async function resolveYuGiOh(card: CardData): Promise<ResolveResult> {
  try {
    // Try exact name match
    const url = `${YGOPRODECK_API}?name=${encodeURIComponent(card.card_name)}`;
    console.log(`YuGiOh lookup: ${url}`);
    
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json();
      if (data.data?.[0]?.card_images?.[0]?.image_url) {
        return { imageUrl: data.data[0].card_images[0].image_url, source: 'ygoprodeck', status: 'found' };
      }
    }

    // Fallback: fuzzy search
    const fuzzyUrl = `${YGOPRODECK_API}?fname=${encodeURIComponent(card.card_name)}`;
    const fuzzyResp = await fetch(fuzzyUrl);
    if (fuzzyResp.ok) {
      const data = await fuzzyResp.json();
      if (data.data?.[0]?.card_images?.[0]?.image_url) {
        return { imageUrl: data.data[0].card_images[0].image_url, source: 'ygoprodeck', status: 'found' };
      }
    }

    return { imageUrl: null, source: null, status: 'not_found' };
  } catch (error: any) {
    console.error('YuGiOh resolve error:', error);
    return { imageUrl: null, source: null, status: 'error', error: error.message };
  }
}

// Sports: eBay Browse API resolver
async function resolveSports(card: CardData): Promise<ResolveResult> {
  try {
    // Build search keywords
    const keywords: string[] = [];
    if (card.year) keywords.push(String(card.year));
    if (card.card_set) keywords.push(card.card_set);
    if (card.player_name) keywords.push(card.player_name);
    else if (card.card_name) keywords.push(card.card_name);
    if (card.card_number) keywords.push(`#${card.card_number.replace(/^#/, '')}`);
    if (card.variant) keywords.push(card.variant);
    keywords.push('card');

    const searchQuery = keywords.join(' ');
    console.log(`Sports card search: ${searchQuery}`);

    // Use AI to find sports card image since we don't have eBay API key
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return { imageUrl: null, source: null, status: 'not_found' };
    }

    const prompt = `Find a direct image URL for this sports trading card:

Card Details:
- Player/Name: ${card.player_name || card.card_name}
- Year: ${card.year || 'Unknown'}
- Set: ${card.card_set || 'Unknown'}
- Number: ${card.card_number || 'Unknown'}
- Variant: ${card.variant || 'Base'}

Search for this card image from these trusted sources:
1. eBay listings (i.ebayimg.com)
2. COMC (comc.com)
3. Beckett (beckett.com)
4. PSA (psacard.com)

Return ONLY the direct image URL (must start with https:// and end with .jpg, .jpeg, .png, or .webp).
If you cannot find a valid direct image URL, respond with exactly: NONE`;

    const aiResp = await callAIGateway({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: "system", content: "You are a sports card image finder. Return only direct image URLs from legitimate card sites. Never fabricate URLs." },
          { role: "user", content: prompt }
        ],
      });

    if (aiResp.ok) {
      const data = await aiResp.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      
      if (content && content !== "NONE" && content.startsWith('https://')) {
        const urlMatch = content.match(/https:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)/i);
        if (urlMatch) {
          return { imageUrl: urlMatch[0], source: 'ebay', status: 'found' };
        }
      }
    }

    return { imageUrl: null, source: null, status: 'not_found' };
  } catch (error: any) {
    console.error('Sports resolve error:', error);
    return { imageUrl: null, source: null, status: 'error', error: error.message };
  }
}

// Download and upload image to Supabase Storage
async function downloadAndStore(
  supabase: any,
  imageUrl: string,
  cardId: string,
  gameType: string,
  setCode: string | null
): Promise<{ storagePath: string; publicUrl: string } | null> {
  try {
    console.log(`Downloading image: ${imageUrl}`);
    
    // SSRF protection on downloaded URLs (may come from AI results)
    const safeUrl = validateImageUrl(imageUrl);
    const resp = await fetch(safeUrl);
    if (!resp.ok) {
      console.error(`Failed to download image: ${resp.status}`);
      return null;
    }

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    if (!contentType.includes('image/')) {
      console.error(`Invalid content type: ${contentType}`);
      return null;
    }

    const arrayBuffer = await resp.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    if (uint8Array.byteLength === 0 || uint8Array.byteLength > 10 * 1024 * 1024) {
      console.error(`Invalid image size: ${uint8Array.byteLength}`);
      return null;
    }

    // Determine extension
    let ext = 'jpg';
    if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('webp')) ext = 'webp';

    // Build storage path: /{game}/{set_code_or_set_name}/{card_id}.{ext}
    const gameFolder = (gameType || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const setFolder = (setCode || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const storagePath = `${gameFolder}/${setFolder}/${cardId}.${ext}`;

    console.log(`Uploading to storage: ${storagePath}`);

    const { error: uploadError } = await supabase.storage
      .from('card-images')
      .upload(storagePath, uint8Array, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`Upload error: ${uploadError.message}`);
      return null;
    }

    // Get signed URL (valid for 1 year)
    const { data: signedData, error: signedError } = await supabase.storage
      .from('card-images')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365);

    if (signedError || !signedData?.signedUrl) {
      console.error(`Signed URL error: ${signedError?.message}`);
      return null;
    }

    return { storagePath, publicUrl: signedData.signedUrl };
  } catch (error: any) {
    console.error(`Download/store error: ${error.message}`);
    return null;
  }
}

// Detect game type from card data
function detectGameType(card: CardData): string {
  const gameType = (card.game_type || card.sport_type || '').toLowerCase();
  
  if (gameType.includes('mtg') || gameType.includes('magic')) return 'mtg';
  if (gameType.includes('pokemon') || gameType.includes('pokémon')) return 'pokemon';
  if (gameType.includes('yugioh') || gameType.includes('yu-gi-oh')) return 'yugioh';
  if (gameType.includes('sports') || gameType.includes('football') || 
      gameType.includes('baseball') || gameType.includes('basketball') ||
      gameType.includes('hockey') || gameType.includes('soccer')) return 'sports';
  
  // Default to sports for unknown types with player_name
  if (card.player_name) return 'sports';
  
  return 'unknown';
}

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

    const { card_id } = await req.json();

    if (!card_id) {
      return new Response(JSON.stringify({ error: 'card_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch card
    const { data: card, error: cardError } = await supabase
      .from('cards')
      .select('*')
      .eq('id', card_id)
      .eq('user_id', user.id)
      .single();

    if (cardError || !card) {
      return new Response(JSON.stringify({ error: 'Card not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if locked
    if (card.image_locked) {
      return new Response(JSON.stringify({ 
        status: 'locked',
        message: 'Image is locked and cannot be changed',
        image_url: card.image_url
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check cache (30 days)
    if (card.image_updated_at && card.image_url && !card.image_url.includes('placehold')) {
      const lastUpdate = new Date(card.image_updated_at).getTime();
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      if (lastUpdate > thirtyDaysAgo) {
        return new Response(JSON.stringify({ 
          status: 'cached',
          image_url: card.image_url,
          source: card.image_source
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`Resolving image for card: ${card.card_name} (${card.id})`);

    // Detect game type and resolve
    const gameType = detectGameType(card);
    let result: ResolveResult;

    switch (gameType) {
      case 'mtg':
        result = await resolveMTG(card);
        break;
      case 'pokemon':
        result = await resolvePokemon(card);
        break;
      case 'yugioh':
        result = await resolveYuGiOh(card);
        break;
      case 'sports':
        result = await resolveSports(card);
        break;
      default:
        // Try all resolvers
        result = await resolveMTG(card);
        if (result.status !== 'found') result = await resolvePokemon(card);
        if (result.status !== 'found') result = await resolveYuGiOh(card);
        if (result.status !== 'found') result = await resolveSports(card);
    }

    if (result.status === 'found' && result.imageUrl) {
      // Download and store in Supabase Storage
      const stored = await downloadAndStore(
        supabase,
        result.imageUrl,
        card.id,
        gameType,
        card.set_code || card.card_set
      );

      if (stored) {
        // Update card with stored image
        await supabase
          .from('cards')
          .update({
            image_url: stored.publicUrl,
            thumbnail_url: stored.publicUrl,
            image_storage_path: stored.storagePath,
            image_source: result.source,
            image_updated_at: new Date().toISOString(),
            image_search_status: 'found',
            image_status: 'ok',
            image_error: null,
          })
          .eq('id', card.id);

        return new Response(JSON.stringify({ 
          status: 'found',
          image_url: stored.publicUrl,
          source: result.source,
          storage_path: stored.storagePath
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        // Store external URL directly if download fails
        await supabase
          .from('cards')
          .update({
            image_url: result.imageUrl,
            thumbnail_url: result.imageUrl,
            image_source: result.source,
            image_updated_at: new Date().toISOString(),
            image_search_status: 'found',
            image_status: 'external',
            image_error: null,
          })
          .eq('id', card.id);

        return new Response(JSON.stringify({ 
          status: 'found',
          image_url: result.imageUrl,
          source: result.source,
          note: 'Stored as external URL (download failed)'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Not found
    await supabase
      .from('cards')
      .update({
        image_search_status: result.status === 'error' ? 'error' : 'not_found',
        image_error: result.error || null,
        image_updated_at: new Date().toISOString(),
      })
      .eq('id', card.id);

    return new Response(JSON.stringify({ 
      status: result.status,
      image_url: null,
      source: null,
      error: result.error
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('resolve-card-image error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
