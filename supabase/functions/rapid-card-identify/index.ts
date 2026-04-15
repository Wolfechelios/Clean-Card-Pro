import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserApiKey, API_KEY_NAMES } from "../_shared/getUserApiKey.ts";
import { buildYgoRarityPromptSection } from "../_shared/ygoRarityMatrix.ts";
import { verifyYgoSetCode } from "../_shared/officialNameResolver.ts";
import { validateImageUrl, SSRFError } from "../_shared/validateUrl.ts";
import { rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl: rawImageUrl, ocrText, gameTypeHint } = await req.json();

    let imageUrl: string;
    try {
      imageUrl = validateImageUrl(rawImageUrl);
    } catch (e) {
      if (e instanceof SSRFError) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw e;
    }

    const normalizedOcrText = normalizeOcrText(ocrText);

    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;
    let supabaseClient: ReturnType<typeof createClient> | null = null;
    
    if (authHeader) {
      supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );
      
      const { data: { user } } = await supabaseClient.auth.getUser();
      userId = user?.id ?? null;

      if (userId) {
        const rl = rateLimitResponse(userId, "rapid-card-identify", corsHeaders, 60, 60_000);
        if (rl) return rl;
      }
    }

    let GEMINI_API_KEY: string | null = null;
    if (userId && supabaseClient) {
      GEMINI_API_KEY = await getUserApiKey(
        supabaseClient,
        userId,
        API_KEY_NAMES.GEMINI,
        'GEMINI_API_KEY'
      );
    } else {
      GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? null;
    }
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    const useGeminiDirect = GEMINI_API_KEY && 
      GEMINI_API_KEY.length > 10 && 
      !GEMINI_API_KEY.startsWith('your_') &&
      !GEMINI_API_KEY.includes('placeholder');
    
    if (!LOVABLE_API_KEY && !useGeminiDirect) {
      throw new Error('No valid API key configured');
    }

    console.log(`Rapid card identification using ${useGeminiDirect ? 'Gemini Direct (user key)' : 'Lovable AI'}...`);

    const ygoRaritySection = buildYgoRarityPromptSection();

    // Game type hint mapping
    const GAME_TYPE_MAP: Record<string, string> = {
      mtg: "MTG", yugioh: "Yu-Gi-Oh!", pokemon: "Pokemon",
      sports: "Sports", gpk: "GPK", marvel: "Marvel", onepiece: "One Piece",
    };
    const canonicalGameType = gameTypeHint && gameTypeHint !== "auto" ? GAME_TYPE_MAP[gameTypeHint] || null : null;

    const gameTypeHintSection = canonicalGameType
      ? `\nIMPORTANT: The user has confirmed this is a ${canonicalGameType} card. Set game_type to "${canonicalGameType}" — do not guess a different game type.\n`
      : "";

    const ocrEvidenceSection = normalizedOcrText
      ? `
OCR EVIDENCE (server-side extracted text, prioritize this over visual guessing when it contains a title, set code, or collector number):
${normalizedOcrText}

OCR PRIORITY RULES:
- Use OCR evidence first for card_name, card_number, and set code when it looks readable.
- Preserve OCR text exactly when copying set codes or collector numbers.
- If the image is ambiguous, lower confidence instead of guessing a famous card.
- Never default to a common classic card unless the printed evidence supports it.
`
      : `
No OCR evidence was provided. Use only printed text visible in the image.
`;

    const prompt = `${gameTypeHintSection}Identify this trading card. Return JSON only:
{
  "card_name": "exact printed name",
  "card_set": "set name or null",
  "card_number": "number or null",
  "rarity": "REQUIRED - use 5-zone matrix for YGO, standard rules for others",
  "game_type": "Pokemon/MTG/YuGiOh/Sports or null",
  "sport_type": "sport type if sports card, else null",
  "year": "year printed on card or estimated year, as string or null",
  "player_name": "athlete/character name if different from card_name, else null",
  "team": "team name if sports card, else null",
  "manufacturer": "card manufacturer (Topps/Panini/Konami/WOTC/Pokemon Company/Upper Deck etc) or null",
  "confidence": 0.0-1.0,
  "foilFeatures": { "only for Yu-Gi-Oh — see foil rarity protocol below" },
  "alternatives": [
    { "card_name": "alt name", "card_set": "alt set", "confidence": 0.0-1.0, "reason": "why this could match" }
  ]
}

CRITICAL NAME RULES:
- Never invent, paraphrase, or auto-correct names.
- Prefer exact printed card name text.
- If OCR evidence contains the title strip or bottom metadata, use that before guessing from artwork.
- If card_number/set code is readable, extract it exactly (keep hyphens/slashes).
- If uncertain, keep the printed name text and LOWER confidence.

METADATA RULES:
- year: Look for copyright year, set release year, or season year printed on the card.
- player_name: For sports cards, extract the athlete name. For TCG, use null unless a character is featured.
- team: For sports cards, extract the team. For TCG, use null.
- manufacturer: Identify from logos/text (Topps, Panini, Konami, Wizards of the Coast, The Pokémon Company, Upper Deck, Fleer, etc).

RARITY RULES (non-YGO):
- Pokemon: Circle=Common, Diamond=Uncommon, Star=Rare, Star H=Holo Rare, Rainbow/Full Art=Secret Rare
- Sports: Base, RC (Rookie Card), Refractor, Prizm, Mosaic, Parallel, Auto, Numbered
- MTG: Black symbol=Common, Silver=Uncommon, Gold=Rare, Orange=Mythic Rare
- If holographic/prismatic/numbered - NOT Common
- NEVER return null for rarity

ALTERNATIVES: ALWAYS include 2-3 alternative identifications in the "alternatives" array — even when confidence is high. Show different printings, sets, or similar-looking cards.

${ocrEvidenceSection}

${ygoRaritySection}

For Yu-Gi-Oh: use SET NUMBER format like LART-EN035 for card_number.
For sports: include player name exactly as printed.
JSON only.`;

    let content: string | null = null;
    let lastError: Error | null = null;
    let lovableExhausted = false;

    // Try Lovable AI FIRST — reduced to 2 retries for speed
    if (LOVABLE_API_KEY) {
      console.log('Trying Lovable AI...');
      for (let attempt = 0; attempt < 2; attempt++) {
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
              max_tokens: 200,
              response_format: { type: "json_object" },
            }),
          });

          if (!response.ok) {
            if (response.status === 429) {
              const delay = Math.min(5000, 1000 * Math.pow(2, attempt));
              console.log(`Lovable AI rate limited, waiting ${delay}ms (attempt ${attempt + 1}/2)`);
              await new Promise(r => setTimeout(r, delay));
              if (attempt === 1) lovableExhausted = true;
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
          if (attempt < 1) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    }

    // Fallback to Gemini Direct if Lovable AI failed/exhausted AND user has valid key
    if (!content && useGeminiDirect && lovableExhausted) {
      console.log('Falling back to Gemini Direct (user key)...');
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
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
                  maxOutputTokens: 200,
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

    // YGO set code verification — correct set name via YGOPRODeck
    try {
      const gameType = (cardData.game_type || "").toLowerCase();
      if (gameType.includes("yu") || gameType.includes("ygo")) {
        const ygoVerified = await verifyYgoSetCode(cardData);
        if (ygoVerified) {
          const oldSet = cardData.card_set;
          cardData.card_name = ygoVerified.card_name;
          cardData.card_set = ygoVerified.card_set;
          cardData.card_number = ygoVerified.card_number;
          if (oldSet !== ygoVerified.card_set) {
            console.log(`YGO set corrected: "${oldSet}" → "${ygoVerified.card_set}"`);
          }
        }
      }
    } catch (ygoErr) {
      console.warn("YGO set verification skipped:", ygoErr);
    }

    // Force game_type override if user specified a hint
    if (canonicalGameType && cardData.card_name !== 'Unknown Card') {
      cardData.game_type = canonicalGameType;
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

function normalizeOcrText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, 2000);
}
