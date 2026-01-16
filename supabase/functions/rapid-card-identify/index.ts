import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Uses user's own Gemini API key for unlimited scanning (no Lovable AI rate limits)
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl } = await req.json();

    if (!imageUrl) {
      throw new Error('imageUrl is required');
    }

    // Prefer Lovable AI (always available), only use Gemini if key is valid
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    // Only use Gemini if key looks valid (not empty, not placeholder)
    const useGeminiDirect = GEMINI_API_KEY && 
      GEMINI_API_KEY.length > 10 && 
      !GEMINI_API_KEY.startsWith('your_') &&
      !GEMINI_API_KEY.includes('placeholder');
    
    if (!LOVABLE_API_KEY && !useGeminiDirect) {
      throw new Error('No valid API key configured');
    }

    console.log(`Rapid card identification using ${useGeminiDirect ? 'Gemini Direct (user key)' : 'Lovable AI'}...`);

    // Prompt for card identification
    const prompt = `Identify this trading card. Return JSON only:
{
  "card_name": "name",
  "card_set": "set name or null",
  "card_number": "number or null",
  "rarity": "REQUIRED - Common/Uncommon/Rare/Holo Rare/Ultra Rare/Secret Rare/Rookie Card/Refractor/Prizm/Parallel/Base/etc",
  "game_type": "Pokemon/MTG/YuGiOh/Sports or null",
  "sport_type": "sport type or null",
  "confidence": 0.0-1.0
}

RARITY RULES:
- Pokemon: Circle=Common, Diamond=Uncommon, Star=Rare, Star H=Holo Rare, Rainbow/Full Art=Secret Rare
- Yu-Gi-Oh: Check name color (silver=Rare, gold=Ultra Rare), holo pattern (Super/Secret/Ultimate/Ghost/Starlight)
- Sports: Base, RC (Rookie Card), Refractor, Prizm, Mosaic, Parallel, Auto, Numbered
- MTG: Black symbol=Common, Silver=Uncommon, Gold=Rare, Orange=Mythic Rare
- If holographic/prismatic/numbered - NOT Common
- NEVER return null for rarity

For Yu-Gi-Oh: use SET NUMBER format like LART-EN035 for card_number.
For sports: include player name in card_name.
JSON only.`;

    let content: string | null = null;
    let lastError: Error | null = null;
    let lovableExhausted = false;

    // Try Lovable AI FIRST (always available, no user key needed)
    if (LOVABLE_API_KEY) {
      console.log('Trying Lovable AI...');
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash-lite',
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: imageUrl } }
                ]
              }],
              temperature: 0.1,
              max_tokens: 300,
            }),
          });

          if (!response.ok) {
            if (response.status === 429) {
              const delay = Math.min(10_000, 1000 * Math.pow(2, attempt));
              console.log(`Lovable AI rate limited, waiting ${delay}ms (attempt ${attempt + 1}/5)`);
              await new Promise(r => setTimeout(r, delay));
              if (attempt === 4) {
                lovableExhausted = true;
              }
              continue;
            }
            if (response.status === 402) {
              lovableExhausted = true;
              console.log('Lovable AI credits exhausted, trying Gemini fallback...');
              break;
            }
            throw new Error(`Lovable AI error: ${response.status}`);
          }

          const data = await response.json();
          content = data.choices?.[0]?.message?.content;
          if (content) {
            console.log('Lovable AI success');
            break;
          }
        } catch (err) {
          lastError = err as Error;
          console.log(`Lovable AI error: ${err}`);
          if (attempt < 4) {
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }
    }

    // Fallback to Gemini Direct if Lovable AI failed/exhausted AND user has valid key
    if (!content && useGeminiDirect && lovableExhausted) {
      console.log('Falling back to Gemini Direct (user key)...');
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          console.log(`Gemini attempt ${attempt + 1}/2...`);
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { text: prompt },
                    { inline_data: { mime_type: 'image/jpeg', data: await fetchImageAsBase64(imageUrl) } }
                  ]
                }],
                generationConfig: {
                  temperature: 0.1,
                  maxOutputTokens: 300,
                }
              }),
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 429) {
              console.log(`Gemini rate limited (attempt ${attempt + 1})`);
              if (attempt < 1) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
              }
            }
            if (response.status === 400 && errorText.includes('API_KEY_INVALID')) {
              console.log('Gemini API key is invalid, skipping fallback');
              break;
            }
            throw new Error(`Gemini error ${response.status}: ${errorText}`);
          }

          const data = await response.json();
          content = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (content) {
            console.log('Gemini Direct fallback success');
            break;
          }
        } catch (err) {
          lastError = err as Error;
          console.log(`Gemini error: ${err}`);
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    }

    if (!content) {
      const errorMsg = lovableExhausted 
        ? 'Rate limited - please try again in a moment' 
        : (lastError?.message || 'No AI response');
      throw new Error(errorMsg);
    }

    // Parse JSON response
    let cardData;
    try {
      const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/) || content.match(/```\n([\s\S]+?)\n```/) || content.match(/\{[\s\S]+\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      cardData = JSON.parse(jsonStr.trim());
    } catch (_e) {
      console.error('Parse error:', content);
      cardData = { card_name: 'Unknown Card', confidence: 0 };
    }

    console.log('Identified:', cardData.card_name);

    return new Response(
      JSON.stringify({ success: true, cardData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Rapid identify error:', error);
    const message = error instanceof Error ? error.message : 'Error';
    const status = /rate limit/i.test(message) ? 429 : 500;

    return new Response(
      JSON.stringify({
        error: message,
        success: false,
        cardData: { card_name: 'Unknown Card', confidence: 0 }
      }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper to fetch image and convert to base64 for Gemini direct API
async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}