import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateImageUrl, SSRFError } from "../_shared/validateUrl.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function downloadAndUploadImage(
  supabase: any,
  remoteUrl: string,
  cardId: string,
  gameType: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    console.log(`Downloading: ${remoteUrl}`);
    
    const response = await fetch(remoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CardScanner/1.0)',
      },
    });
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('image/')) {
      return { success: false, error: `Invalid content type: ${contentType}` };
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const size = uint8Array.byteLength;
    
    if (size === 0) {
      return { success: false, error: 'Empty image' };
    }
    
    if (size > 10 * 1024 * 1024) {
      return { success: false, error: 'Image too large' };
    }

    let ext = 'jpg';
    if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('webp')) ext = 'webp';

    const gameFolder = (gameType || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const filePath = `cards/${gameFolder}/${cardId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('card-images')
      .upload(filePath, uint8Array, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from('card-images')
      .createSignedUrl(filePath, 60 * 60 * 24 * 365);

    if (signedError) {
      return { success: false, error: signedError.message };
    }

    return { success: true, url: signedData.signedUrl };
  } catch (error: any) {
    return { success: false, error: error.message };
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

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(body.limit || 20, 50);

    console.log(`Refreshing external images for user ${user.id}, limit: ${limit}`);

    // Find cards with external URLs (not from our storage, not locked)
    // External URLs are ones that don't contain our Supabase storage domain
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const storageDomain = supabaseUrl.replace('https://', '');

    const { data: cards, error: cardsError } = await supabase
      .from('cards')
      .select('id, card_name, card_set, game_type, sport_type, image_url, image_locked')
      .eq('user_id', user.id)
      .eq('image_locked', false)
      .not('image_url', 'is', null)
      .not('image_url', 'ilike', `%${storageDomain}%`)
      .not('image_url', 'ilike', '%placehold%')
      .limit(limit);

    if (cardsError) {
      console.error('Error fetching cards:', cardsError);
      return new Response(JSON.stringify({ error: cardsError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({
        processed: 0,
        success: 0,
        failed: 0,
        message: 'No external images to refresh',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${cards.length} cards with external images`);

    let successCount = 0;
    let failedCount = 0;
    const results: any[] = [];

    // Process cards sequentially to avoid rate limits
    for (const card of cards) {
      const gameType = card.game_type || card.sport_type || 'unknown';
      const result = await downloadAndUploadImage(supabase, card.image_url, card.id, gameType);

      if (result.success && result.url) {
        // Update card with stored URL
        await supabase
          .from('cards')
          .update({
            image_url: result.url,
            thumbnail_url: result.url,
            image_storage_path: `cards/${gameType.toLowerCase().replace(/[^a-z0-9]/g, '_')}/${card.id}.jpg`,
            image_source: 'refreshed',
            image_status: 'ok',
            image_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', card.id);

        successCount++;
        results.push({ id: card.id, name: card.card_name, status: 'success' });
      } else {
        failedCount++;
        results.push({ id: card.id, name: card.card_name, status: 'failed', error: result.error });
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`Refresh complete: ${successCount} success, ${failedCount} failed`);

    return new Response(JSON.stringify({
      processed: cards.length,
      success: successCount,
      failed: failedCount,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Refresh external images error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
