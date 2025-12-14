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
    const { imageUrl, ocrText } = await req.json();

    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    // Reject placeholder URLs - they can't be analyzed
    if (imageUrl.includes('placehold.co') || imageUrl.includes('placeholder')) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Cannot analyze placeholder images. Please provide a real card image.',
          noCardDetected: true
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log('Analyzing card with Lovable AI...');

    // Prepare the prompt for card identification with multiple options
    const prompt = `You are an expert trading card identifier specializing in sports cards, Pokémon, Magic: The Gathering, Yu-Gi-Oh!, and other collectible card games.

Analyze this trading card image and provide the most likely card identification along with up to 2 alternative possibilities if you're not completely certain.

CRITICAL FOR YU-GI-OH CARDS:
- Look for the SET NUMBER on the right side, just below the card artwork
- Format: [SET CODE]-EN[NUMBER] (e.g., "LART-EN035", "SDK-EN001", "LOB-EN001")
- This is typically separated by a dash (-) followed by "EN" and then a number
- This set number is the MOST RELIABLE identifier for Yu-Gi-Oh cards
- Also look for the 8-digit passcode number (e.g., "89631139") which can help confirm identity
- Use the set number as the PRIMARY identification method

Return JSON in this exact format:

{
  "primary": {
    "card_name": "exact card name",
    "card_set": "set name",
    "card_number": "set number (e.g., LART-EN035) for Yu-Gi-Oh",
    "rarity": "rarity level",
    "edition": "edition (e.g., 1st Edition, Unlimited, etc.)",
    "game_type": "Pokemon/MTG/YuGiOh/etc or null for sports",
    "sport_type": "Baseball/Basketball/Football/etc or null for games",
    "year": "year of release",
    "manufacturer": "manufacturer name",
    "confidence": "confidence score 0-1",
    "description": "brief description of the card"
  },
  "alternatives": [
    {
      "card_name": "alternative card name",
      "card_set": "alternative set name",
      "confidence": "confidence score 0-1",
      "reason": "why this could be an alternative"
    }
  ]
}

${ocrText ? `OCR text extracted: ${ocrText}` : ''}

Only include alternatives array if confidence is below 0.95. If completely certain, return empty alternatives array. For Yu-Gi-Oh cards, ALWAYS look for the set number in [CODE]-EN[NUMBER] format on the right side below the artwork.`;

    const messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt
          },
          {
            type: "image_url",
            image_url: {
              url: imageUrl
            }
          }
        ]
      }
    ];

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in AI response');
    }

    // Parse the JSON response from the AI
    let cardData;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/) || content.match(/```\n([\s\S]+?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      cardData = JSON.parse(jsonStr.trim());
    } catch (e) {
      console.error('Failed to parse AI response as JSON:', content);
      
      // Check if AI couldn't identify a card or image is bad
      const lowerContent = content.toLowerCase();
      if (lowerContent.includes('cannot') || 
          lowerContent.includes('no trading card') || 
          lowerContent.includes('no visible') ||
          lowerContent.includes('not a trading card') ||
          lowerContent.includes('unable to') ||
          lowerContent.includes('completely black') ||
          lowerContent.includes('black image') ||
          lowerContent.includes('upload a clear') ||
          lowerContent.includes('sorry') ||
          lowerContent.includes('provide any information') ||
          !lowerContent.includes('{')) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Could not identify card. Please ensure the card is clearly visible and well-lit.',
            noCardDetected: true
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      
      throw new Error('Failed to parse card identification response');
    }

    console.log('Card identified:', cardData);

    return new Response(
      JSON.stringify({
        success: true,
        cardData,
        rawResponse: content
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in enhanced-card-identify:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
