import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cardName, cardSet, gameType, searchQuery } = await req.json();

    if (!cardName) {
      return new Response(
        JSON.stringify({ error: 'cardName is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      // Return a descriptive placeholder if no API key
      const placeholderUrl = `https://placehold.co/300x400/1a1a2e/eee?text=${encodeURIComponent(cardName.substring(0, 25))}`;
      return new Response(
        JSON.stringify({ imageUrl: placeholderUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use AI to find the most likely image source for this card
    const prompt = `You are a trading card database expert. Given this card information, provide ONLY a direct image URL to a representative card image from a public source like tcgplayer.com, cardmarket.com, or similar card database.

Card Name: ${cardName}
Set: ${cardSet || 'Unknown'}
Game/Sport: ${gameType || 'Unknown'}

Return ONLY a valid image URL, nothing else. If you cannot find a specific image, respond with "NONE".`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      console.error('AI request failed:', response.status);
      const placeholderUrl = `https://placehold.co/300x400/1a1a2e/eee?text=${encodeURIComponent(cardName.substring(0, 25))}`;
      return new Response(
        JSON.stringify({ imageUrl: placeholderUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    // Validate URL
    if (content && content !== "NONE" && content.startsWith('http')) {
      // Verify it's a valid URL
      try {
        new URL(content);
        return new Response(
          JSON.stringify({ imageUrl: content }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch {
        // Invalid URL
      }
    }

    // Return a styled placeholder with card info
    const displayText = cardSet 
      ? `${cardName.substring(0, 15)}%0A${cardSet.substring(0, 15)}`
      : cardName.substring(0, 25);
    const placeholderUrl = `https://placehold.co/300x400/1a1a2e/eee?text=${encodeURIComponent(displayText)}`;

    return new Response(
      JSON.stringify({ imageUrl: placeholderUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('generate-card-image-url error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
