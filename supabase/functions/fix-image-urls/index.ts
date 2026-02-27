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

    // Find all cards with signed URLs (contain /object/sign/ and ?token=)
    const { data: cards, error: fetchError } = await supabase
      .from('cards')
      .select('id, image_url, thumbnail_url, image_storage_path')
      .eq('user_id', user.id)
      .or('image_url.like.%/object/sign/%,thumbnail_url.like.%/object/sign/%');

    if (fetchError) throw fetchError;

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ fixed: 0, message: 'No signed URLs found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${cards.length} cards with signed URLs`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    let fixed = 0;

    for (const card of cards) {
      const updates: Record<string, string> = {};

      if (card.image_url?.includes('/object/sign/')) {
        // Extract the storage path from the signed URL
        const match = card.image_url.match(/\/object\/sign\/([^?]+)/);
        if (match) {
          const bucketAndPath = match[1]; // e.g. "card-images/cards/game/id.jpg"
          const storagePath = bucketAndPath.replace('card-images/', '');
          const { data } = supabase.storage.from('card-images').getPublicUrl(storagePath);
          updates.image_url = data.publicUrl;
          updates.image_storage_path = storagePath;
        }
      }

      if (card.thumbnail_url?.includes('/object/sign/')) {
        const match = card.thumbnail_url.match(/\/object\/sign\/([^?]+)/);
        if (match) {
          const storagePath = match[1].replace('card-images/', '');
          const { data } = supabase.storage.from('card-images').getPublicUrl(storagePath);
          updates.thumbnail_url = data.publicUrl;
        }
      }

      if (Object.keys(updates).length > 0) {
        updates.image_status = 'ok';
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
