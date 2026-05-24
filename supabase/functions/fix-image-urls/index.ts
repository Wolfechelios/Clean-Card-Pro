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
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Fixing image URLs for user ${user.id}`);

    // Find cards with expired signed URLs, bad status, or recoverable storage paths.
    const { data: cards, error: fetchError } = await supabase
      .from('cards')
      .select('id, image_url, thumbnail_url, image_storage_path, image_status, image_search_status')
      .eq('user_id', user.id)
      .or('image_url.like.%/object/sign/%,thumbnail_url.like.%/object/sign/%,image_url.like.%/object/authenticated/%,thumbnail_url.like.%/object/authenticated/%,image_status.in.(failed,external),image_search_status.in.(error,not_found)');

    if (fetchError) throw fetchError;

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ fixed: 0, message: 'No broken image URLs found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${cards.length} cards with signed URLs`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    let fixed = 0;

    for (const card of cards) {
      const updates: Record<string, string> = {};

      const storedPath = card.image_storage_path || null;

      if (card.image_url?.includes('/object/sign/') || card.image_url?.includes('/object/authenticated/')) {
        // Extract the storage path from the signed URL
        const match = card.image_url.match(/\/object\/(?:sign|authenticated)\/([^?]+)/);
        if (match) {
          const bucketAndPath = match[1]; // e.g. "card-images/cards/game/id.jpg"
          const storagePath = bucketAndPath.replace('card-images/', '');
          const { data } = supabase.storage.from('card-images').getPublicUrl(storagePath);
          updates.image_url = data.publicUrl;
          updates.image_storage_path = storagePath;
        }
      }

      if (card.thumbnail_url?.includes('/object/sign/') || card.thumbnail_url?.includes('/object/authenticated/')) {
        const match = card.thumbnail_url.match(/\/object\/(?:sign|authenticated)\/([^?]+)/);
        if (match) {
          const storagePath = match[1].replace('card-images/', '');
          const { data } = supabase.storage.from('card-images').getPublicUrl(storagePath);
          updates.thumbnail_url = data.publicUrl;
        }
      }

      if (storedPath && Object.keys(updates).length === 0) {
        const { data } = supabase.storage.from('card-images').getPublicUrl(storedPath);
        updates.image_url = data.publicUrl;
        updates.thumbnail_url = data.publicUrl;
      }

      if (Object.keys(updates).length > 0) {
        updates.image_status = 'ok';
        updates.image_search_status = 'found';
        const { error: updateError } = await supabase
          .from('cards')
          .update(updates)
          .eq('id', card.id);

        if (!updateError) fixed++;
        else console.error(`Failed to update card ${card.id}:`, updateError);
      }
    }

    console.log(`Fixed ${fixed} card image URLs`);

    return new Response(JSON.stringify({ fixed, total: cards.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Fix image URLs error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
