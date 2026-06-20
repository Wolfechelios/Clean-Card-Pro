import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveOfficialCardIdentity, verifyYgoSetCode } from "../_shared/officialNameResolver.ts";
import { buildYgoRarityPromptSection } from "../_shared/ygoRarityMatrix.ts";
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

  // Rate limit by user (extract sub from JWT)
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.sub) {
        const rl = rateLimitResponse(payload.sub, "enhanced-card-identify", corsHeaders, 30, 60_000);
        if (rl) return rl;
      }
    }
  } catch { /* continue without rate limiting if JWT parse fails */ }

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

    const prompt = `${gameTypeHintSection}You are an expert trading card identifier specializing in sports cards, Pokémon, Magic: The Gathering, Yu-Gi-Oh!, and other collectible card games.

Analyze this trading card image and provide the most likely card identification along with up to 2 alternative possibilities if you're not completely certain.

CRITICAL NAME RULES — DO NOT CHANGE THE CARD NAME:
1. Use the EXACT name as printed on the card. Do NOT paraphrase, translate, abbreviate, or "correct" spelling.
2. If you can read the card number/set code, cross-reference it against the official card database for that game to confirm the EXACT official English name for that card number.
3. Priority order for name: (a) official name by card number lookup, (b) exact text printed on the card, (c) your best identification — but NEVER invent or alter a name.
4. For sports cards: use the player name exactly as printed. Do NOT change formatting (e.g. "Ken Griffey Jr." stays as-is, not "Kenneth Griffey Junior").

CRITICAL FOR YU-GI-OH CARDS — ROI-BASED DETECTION (NO GUESSING):

STEP 1 — REGIONS OF INTEREST:
A. Set Code Region: Crop bottom 18-25% of image vertically, then isolate rightmost 30-40% horizontally. Set code is in small text directly ABOVE copyright line, right-aligned near card border.
B. Edition Region: Crop bottom 35-50% of image vertically, then isolate leftmost 30-40% horizontally. Edition marker appears below artwork frame, left-aligned.

STEP 2 — SET CODE EXTRACTION:
Strict regex: \\b[A-Z0-9]{2,5}-[A-Z]{0,2}[0-9]{3}\\b
Valid: LOB-001, SDK-003, MRD-EN045, MP23-EN001, BLMR-EN045
Rules: MUST contain hyphen, MUST end in exactly 3 digits. Ignore non-matching text. Extract ONLY first valid match. No match → "Not Detected".

STEP 3 — EDITION DETECTION:
Search ONLY within Edition Region for exact case-sensitive string "1st Edition".
Do NOT accept: "First Edition", "1st Ed", "1st", or partial text.
If found → edition = "1st Edition". If NOT found → edition = "Unlimited".

STEP 4 — DO NOT CONFUSE WITH:
Ignore: Card name (top center), attribute icon (top right), ATK/DEF (bottom right large font), serial number inside artwork box, holographic square stamp (older prints). Set Code is ALWAYS above copyright line. Edition stamp is below artwork frame on lower-left.

Also look for the 8-digit passcode number (e.g., "89631139") to confirm identity.

STEP 5 — NAME VERIFICATION BY CARD NUMBER:
If you extracted a valid set code (e.g., LOB-001), look up the official card name for that exact set code. Use THAT official name as "card_name". Do NOT use the name you read from the card image if it differs from the official database entry for that number.

${ygoRaritySection}

CRITICAL FOR MAGIC: THE GATHERING CARDS — SET & YEAR IDENTIFICATION:

STEP 1 — SET SYMBOL (bottom-center-right of card, to the right of the type line):
Describe the shape and color of the set symbol. Color indicates rarity: black/grey = Common, silver = Uncommon, gold = Rare, orange-red/mythic orange = Mythic Rare. Use the symbol shape to determine the exact set (e.g., a stylized 'M' for Core Sets, a dragon head for Dragons of Tarkir, etc.).

STEP 2 — COLLECTOR NUMBER (bottom-left of card):
Look for text in format "123/280" or just "123". This is the collector number. Extract BOTH the card number and total. Format: "123/280".

STEP 3 — COPYRIGHT YEAR (very bottom center of card):
Read the copyright line: "© 2010 Wizards of the Coast" or "™ & © 2021 Wizards...". Extract the 4-digit year. This is the printing year and determines which set/printing this card belongs to.

STEP 4 — FRAME STYLE (helps narrow the era):
- Pre-8th Edition (before 2003): old-style brown/grey/blue borders, no holofoil stamp
- 8th Edition to M14 (2003-2013): modern silver/black border, no holofoil stamp
- M15 onward (2014+): updated frame with holofoil oval stamp at bottom-center of card (below art, above text box)
- Post-2024 frames may have additional design changes

STEP 5 — MTG OUTPUT REQUIREMENTS:
You MUST populate ALL of these for MTG cards:
- "card_name": exact name as printed
- "card_set": full set name (e.g., "Magic 2010", "Innistrad: Midnight Hunt", "Revised Edition")
- "card_number": collector number in "123/280" format if visible
- "year": the copyright year (4-digit number)
- "rarity": Common/Uncommon/Rare/Mythic Rare based on set symbol color

Return JSON in this exact format:

{
  "primary": {
    "card_name": "EXACT name as printed on card or verified by card number lookup",
    "card_set": "set name",
    "card_number": "set code from ROI extraction (e.g., LART-EN035)",
    "rarity": "rarity level — for Yu-Gi-Oh use the 5-zone matrix rarity name",
    "edition": "1st Edition or Unlimited — determined ONLY by exact '1st Edition' text in Edition Region",
    "game_type": "Pokemon/MTG/YuGiOh/etc or null for sports",
    "sport_type": "Baseball/Basketball/Football/etc or null for games",
    "year": "year of release",
    "manufacturer": "manufacturer name",
    "confidence": "confidence score 0-1",
    "description": "brief description of the card",
    "foilFeatures": {
      "nameFoil": "none|silver|gold|rainbow",
      "artPattern": "none|secretDiagonal|starlight|lattice|ghost|foil",
      "borderFoil": true/false,
      "watermark": true/false,
      "embossTexture": true/false
    }
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

ALWAYS include 2-3 alternative identifications in the alternatives array — even when confidence is high. Show different printings, sets, or similar-looking cards. This helps the user verify the correct match.
For non-Yu-Gi-Oh cards, omit the foilFeatures object.`;

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

    try {
      if (cardData?.primary && typeof cardData.primary === "object") {
        cardData.primary = await resolveOfficialCardIdentity(cardData.primary, { ocrText });
        // Additional YGO set code verification
        const gameType = (cardData.primary.game_type || "").toLowerCase();
        if (gameType.includes("yu") || gameType.includes("ygo")) {
          const ygoVerified = await verifyYgoSetCode(cardData.primary);
          if (ygoVerified) {
            const oldSet = cardData.primary.card_set;
            cardData.primary.card_name = ygoVerified.card_name;
            cardData.primary.card_set = ygoVerified.card_set;
            cardData.primary.card_number = ygoVerified.card_number;
            if (oldSet !== ygoVerified.card_set) {
              console.log(`YGO set corrected: "${oldSet}" → "${ygoVerified.card_set}"`);
            }
          }
        }
      } else if (cardData && typeof cardData === "object") {
        cardData = await resolveOfficialCardIdentity(cardData, { ocrText });
      }
    } catch (verifyError) {
      console.warn("Official name verification skipped:", verifyError);
    }

    // Force game_type override if user specified a hint
    if (canonicalGameType) {
      if (cardData?.primary && typeof cardData.primary === "object") {
        cardData.primary.game_type = canonicalGameType;
      } else if (cardData && typeof cardData === "object") {
        cardData.game_type = canonicalGameType;
      }
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
