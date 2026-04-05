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
): Promise<string> {
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
  
  // Minimum size check - real card images are typically >5KB
  // Small images (< 5KB) are usually error placeholders or broken images
  if (size < 5000) {
    throw new Error(`Image too small (${size} bytes) - likely a placeholder or error image`);
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

  // Get public URL (bucket is now public)
  const { data: publicData } = supabase.storage
    .from('card-images')
    .getPublicUrl(filePath);

  return publicData.publicUrl;
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

    const { cardId, remoteImageUrl } = await req.json();

    if (!cardId || !remoteImageUrl) {
      return new Response(JSON.stringify({ error: 'cardId and remoteImageUrl are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Attaching image to card ${cardId}: ${remoteImageUrl}`);

    // Verify card belongs to user
    const { data: card, error: cardError } = await supabase
      .from('cards')
      .select('*')
      .eq('id', cardId)
      .eq('user_id', user.id)
      .single();

    if (cardError || !card) {
      return new Response(JSON.stringify({ error: 'Card not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update status to fetching
    await supabase
      .from('cards')
      .update({
        image_status: 'fetching',
        image_last_attempt_at: new Date().toISOString(),
      })
      .eq('id', cardId);

    try {
      const gameType = card.game_type || card.sport_type || 'unknown';
      const storedUrl = await downloadAndUploadImage(supabase, remoteImageUrl, cardId, gameType);

      // Update card with new image
      await supabase
        .from('cards')
        .update({
          image_url: storedUrl,
          thumbnail_url: storedUrl,
          image_status: 'ok',
          image_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cardId);

      console.log(`Successfully attached image to card ${cardId}`);

      return new Response(JSON.stringify({
        success: true,
        imageUrl: storedUrl,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error: any) {
      console.error(`Failed to download/upload image for card ${cardId}:`, error);
      
      // If download fails (DNS, network, HTTP errors, etc.), store the external URL directly
      // The browser can try to load it - some sources work via direct browser access
      const isDnsOrNetworkError = error.message?.includes('dns error') || 
                                   error.message?.includes('Connect') ||
                                   error.message?.includes('failed to fetch') ||
                                   error.message?.includes('Failed to download');
      
      if (isDnsOrNetworkError) {
        console.log(`Falling back to storing external URL directly for card ${cardId}`);
        
        await supabase
          .from('cards')
          .update({
            image_url: remoteImageUrl,
            thumbnail_url: remoteImageUrl,
            image_status: 'external',
            image_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', cardId);

        return new Response(JSON.stringify({
          success: true,
          imageUrl: remoteImageUrl,
          note: 'Stored external URL directly (download failed)',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Other errors - mark as failed
      await supabase
        .from('cards')
        .update({
          image_status: 'failed',
          image_error: error.message,
        })
        .eq('id', cardId);

      return new Response(JSON.stringify({
        success: false,
        error: error.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error: any) {
    console.error('Attach image error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
