const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_base64, game_type } = await req.json();

    if (!image_base64) {
      return new Response(
        JSON.stringify({ error: 'image_base64 is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const gameContext = game_type === 'yugioh'
      ? `Yu-Gi-Oh! rarities: Common, Rare (silver name), Super Rare (foil art), Ultra Rare (foil art + name), Secret Rare (diagonal holographic lines), Starlight Rare (dense sparkle pattern + rainbow name), Ghost Rare (3D translucent), Ultimate Rare (embossed texture), Collector's Rare (lattice pattern).`
      : game_type === 'pokemon'
      ? `Pokémon rarities: Common, Uncommon, Rare, Holo Rare (holographic artwork), Reverse Holo (holographic background/border), Ultra Rare (Full Art, EX, GX, V, VMAX, VSTAR), Secret Rare (set number exceeds total), Special Art Rare, Illustration Rare.`
      : game_type === 'mtg'
      ? `Magic: The Gathering finishes: Normal, Foil (full holographic sheen), Etched Foil (metallic etched pattern), Gilded (gold border accents), Surge Foil (swirling pattern), Galaxy Foil (sparkle dots), Textured Foil (raised texture).`
      : `Trading card finishes: Normal, Holographic (full image shimmer), Reverse Holographic (background-only foil), Secret/Prismatic (diagonal line pattern), Foil/Chrome (metallic surface).`;

    const systemPrompt = `You are an expert trading card foil and rarity classifier. Analyze the card image to determine its physical finish and rarity based on visual characteristics — NOT text. Focus on:
1. Surface reflectivity and holographic patterns
2. Foil coverage areas (name plate, artwork, borders, background)
3. Pattern type (diagonal lines, shimmer, sparkle clusters, emboss texture, lattice)
4. Color shifts in the foil (silver, gold, rainbow)

${gameContext}

You MUST use the classify_foil_rarity tool to return your analysis.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this trading card image and classify its foil type and rarity based on visual characteristics.' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image_base64}` } },
            ],
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'classify_foil_rarity',
              description: 'Classify the foil type and rarity of a trading card based on visual analysis.',
              parameters: {
                type: 'object',
                properties: {
                  rarity: {
                    type: 'string',
                    description: 'The detected rarity/finish of the card',
                  },
                  simplified_class: {
                    type: 'string',
                    enum: ['normal', 'holo', 'reverse_holo', 'secret_rare'],
                    description: 'Simplified foil classification',
                  },
                  confidence: {
                    type: 'number',
                    description: 'Confidence score 0-100',
                  },
                  foil_areas: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Areas where foil is detected (e.g., name_plate, artwork, border, background)',
                  },
                  pattern_type: {
                    type: 'string',
                    description: 'Type of foil pattern detected (e.g., diagonal_lines, shimmer, sparkle, emboss, lattice, none)',
                  },
                  reasoning: {
                    type: 'string',
                    description: 'Brief explanation of classification reasoning',
                  },
                },
                required: ['rarity', 'simplified_class', 'confidence', 'foil_areas', 'pattern_type', 'reasoning'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'classify_foil_rarity' } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again shortly.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits in Settings.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errText = await response.text();
      console.error('AI gateway error:', response.status, errText);
      return new Response(
        JSON.stringify({ error: 'AI analysis failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ error: 'AI did not return structured output' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Foil analysis error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
