import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Provider functions
async function fetchMTGImage(card: any): Promise<string | null> {
  try {
    let url = '';
    
    // Priority 1: Scryfall ID
    if (card.external_id && card.external_source === 'scryfall') {
      url = `https://api.scryfall.com/cards/${card.external_id}`;
    }
    // Priority 2: Set code + collector number
    else if (card.card_set && card.card_number) {
      const setCode = card.card_set.toLowerCase().replace(/\s+/g, '');
      url = `https://api.scryfall.com/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(card.card_number)}`;
    }
    // Priority 3: Exact name search
    else {
      url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(card.card_name)}`;
    }

    console.log(`MTG lookup: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`MTG lookup failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    // Prefer large, then normal, then small
    return data.image_uris?.large || data.image_uris?.normal || data.image_uris?.small || null;
  } catch (error) {
    console.error('MTG fetch error:', error);
    return null;
  }
}

async function fetchPokemonImage(card: any): Promise<string | null> {
  try {
    let url = '';
    
    // Priority 1: Pokemon TCG ID
    if (card.external_id && card.external_source === 'pokemontcg') {
      url = `https://api.pokemontcg.io/v2/cards/${card.external_id}`;
    }
    // Priority 2: Search by name + set + number
    else {
      let query = `name:"${card.card_name}"`;
      if (card.card_set) {
        query += ` set.name:"${card.card_set}"`;
      }
      if (card.card_number) {
        query += ` number:"${card.card_number}"`;
      }
      url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=1`;
    }

    console.log(`Pokemon lookup: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`Pokemon lookup failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (card.external_id) {
      return data.data?.images?.large || data.data?.images?.small || null;
    } else {
      const cards = data.data;
      if (cards && cards.length > 0) {
        return cards[0].images?.large || cards[0].images?.small || null;
      }
    }
    return null;
  } catch (error) {
    console.error('Pokemon fetch error:', error);
    return null;
  }
}

async function fetchYuGiOhImage(card: any): Promise<string | null> {
  try {
    let url = '';
    
    // Priority 1: YGOProDeck ID
    if (card.external_id && card.external_source === 'ygoprodeck') {
      url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${card.external_id}`;
    }
    // Priority 2: Exact name search
    else {
      url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(card.card_name)}`;
    }

    console.log(`YuGiOh lookup: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`YuGiOh lookup failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const cardData = data.data?.[0];
    if (cardData?.card_images?.[0]) {
      return cardData.card_images[0].image_url || cardData.card_images[0].image_url_small || null;
    }
    return null;
  } catch (error) {
    console.error('YuGiOh fetch error:', error);
    return null;
  }
}

async function downloadAndUploadImage(
  supabase: any,
  remoteUrl: string,
  cardId: string,
  gameType: string
): Promise<string | null> {
  try {
    console.log(`Downloading image from: ${remoteUrl}`);
    
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('image/')) {
      throw new Error(`Invalid content type: ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const size = uint8Array.byteLength;
    
    console.log(`Downloaded image: ${size} bytes, content-type: ${contentType}`);
    
    // Max 10MB
    if (size > 10 * 1024 * 1024) {
      throw new Error(`Image too large: ${size} bytes`);
    }
    
    // Ensure we actually got data
    if (size === 0) {
      throw new Error('Downloaded empty image file');
    }

    // Determine extension
    let ext = 'jpg';
    if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('webp')) ext = 'webp';

    const gameFolder = (gameType || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const filePath = `cards/${gameFolder}/${cardId}.${ext}`;

    console.log(`Uploading to: ${filePath} (${size} bytes)`);

    const { error: uploadError } = await supabase.storage
      .from('card-images')
      .upload(filePath, uint8Array, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Get signed URL (valid for 1 year)
    const { data: signedData, error: signedError } = await supabase.storage
      .from('card-images')
      .createSignedUrl(filePath, 60 * 60 * 24 * 365);

    if (signedError) {
      throw new Error(`Failed to create signed URL: ${signedError.message}`);
    }

    return signedData.signedUrl;
  } catch (error) {
    console.error('Download/upload error:', error);
    throw error;
  }
}

async function processCard(
  supabase: any,
  card: any
): Promise<{ status: string; error?: string }> {
  const gameType = (card.game_type || card.sport_type || '').toLowerCase();
  
  try {
    // Update status to fetching
    await supabase
      .from('cards')
      .update({
        image_status: 'fetching',
        image_last_attempt_at: new Date().toISOString(),
      })
      .eq('id', card.id);

    let remoteImageUrl: string | null = null;

    // Determine game type and fetch from appropriate provider
    if (gameType.includes('magic') || gameType.includes('mtg')) {
      remoteImageUrl = await fetchMTGImage(card);
    } else if (gameType.includes('pokemon') || gameType.includes('pokémon')) {
      remoteImageUrl = await fetchPokemonImage(card);
    } else if (gameType.includes('yugioh') || gameType.includes('yu-gi-oh')) {
      remoteImageUrl = await fetchYuGiOhImage(card);
    } else if (gameType.includes('sports') || gameType.includes('football') || 
               gameType.includes('baseball') || gameType.includes('basketball') ||
               gameType.includes('hockey') || gameType.includes('soccer') ||
               card.sport_type) {
      // Sports: check if we have a valid external image source
      if (card.external_id && card.external_source) {
        // If we have an external ID with known source, might have a URL stored
        // For now, mark as needs_review since sports don't have universal API
        remoteImageUrl = null;
      }
      
      if (!remoteImageUrl) {
        // Sports cards need manual review
        await supabase
          .from('cards')
          .update({
            image_status: 'needs_review',
            image_error: 'Sports cards require manual image attachment - no universal API available',
          })
          .eq('id', card.id);
        return { status: 'needs_review', error: 'Sports cards require manual attachment' };
      }
    } else {
      // Try Scryfall first (works for many TCGs), then Pokemon
      remoteImageUrl = await fetchMTGImage(card);
      if (!remoteImageUrl) {
        remoteImageUrl = await fetchPokemonImage(card);
      }
    }

    if (!remoteImageUrl) {
      await supabase
        .from('cards')
        .update({
          image_status: 'failed',
          image_error: 'Could not find image from any provider',
        })
        .eq('id', card.id);
      return { status: 'failed', error: 'No image found from providers' };
    }

    // Download and upload to our storage
    const storedUrl = await downloadAndUploadImage(supabase, remoteImageUrl, card.id, gameType);

    if (!storedUrl) {
      await supabase
        .from('cards')
        .update({
          image_status: 'failed',
          image_error: 'Failed to store image',
        })
        .eq('id', card.id);
      return { status: 'failed', error: 'Failed to store image' };
    }

    // Success - update card with new image URL
    await supabase
      .from('cards')
      .update({
        image_url: storedUrl,
        thumbnail_url: storedUrl,
        image_status: 'ok',
        image_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', card.id);

    return { status: 'ok' };
  } catch (error: any) {
    console.error(`Error processing card ${card.id}:`, error);
    await supabase
      .from('cards')
      .update({
        image_status: 'failed',
        image_error: error.message || 'Unknown error',
      })
      .eq('id', card.id);
    return { status: 'failed', error: error.message };
  }
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

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      limit = 50,
      game = null,
      onlyStatus = 'missing',
      concurrency = 3,
    } = body;

    console.log(`Backfill request: limit=${limit}, game=${game}, onlyStatus=${onlyStatus}, concurrency=${concurrency}`);

    // Build query for cards needing backfill
    let query = supabase
      .from('cards')
      .select('*')
      .eq('user_id', user.id)
      .limit(limit);

    // Filter by status
    if (onlyStatus === 'missing') {
      query = query.or('image_url.is.null,image_url.ilike.%placehold%,image_status.eq.missing');
    } else if (onlyStatus === 'failed') {
      query = query.eq('image_status', 'failed');
    } else if (onlyStatus === 'needs_review') {
      query = query.eq('image_status', 'needs_review');
    }

    // Filter by game type
    if (game && game !== 'all') {
      if (game === 'sports') {
        query = query.or('game_type.ilike.%sports%,sport_type.not.is.null');
      } else if (game === 'mtg') {
        query = query.or('game_type.ilike.%magic%,game_type.ilike.%mtg%,sport_type.ilike.%magic%');
      } else if (game === 'pokemon') {
        query = query.or('game_type.ilike.%pokemon%,sport_type.ilike.%pokemon%');
      } else if (game === 'yugioh') {
        query = query.or('game_type.ilike.%yugioh%,game_type.ilike.%yu-gi-oh%');
      }
    }

    const { data: cards, error: queryError } = await query;

    if (queryError) {
      throw queryError;
    }

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({
        processed: 0,
        succeeded: 0,
        failed: 0,
        needs_review: 0,
        results: [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${cards.length} cards to process`);

    const results: any[] = [];
    let succeeded = 0;
    let failed = 0;
    let needsReview = 0;

    // Process in batches for concurrency control
    for (let i = 0; i < cards.length; i += concurrency) {
      const batch = cards.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (card) => {
          const result = await processCard(supabase, card);
          return {
            id: card.id,
            name: card.card_name,
            game: card.game_type || card.sport_type || 'unknown',
            status: result.status,
            error: result.error,
          };
        })
      );

      for (const r of batchResults) {
        results.push(r);
        if (r.status === 'ok') succeeded++;
        else if (r.status === 'needs_review') needsReview++;
        else failed++;
      }

      // Small delay between batches to avoid rate limiting
      if (i + concurrency < cards.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`Backfill complete: succeeded=${succeeded}, failed=${failed}, needs_review=${needsReview}`);

    return new Response(JSON.stringify({
      processed: results.length,
      succeeded,
      failed,
      needs_review: needsReview,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Backfill error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
