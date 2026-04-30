// supabase/functions/analyze-card-full/index.ts
// Full card analysis using Lovable AI (Gemini 2.5 Flash with vision)
// No external billing required!

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { validateImageUrl, SSRFError } from "../_shared/validateUrl.ts";
import { rateLimitResponse } from "../_shared/rateLimiter.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RequestBody = {
  image_url: string;
  card_id?: string;
  game?: string;
  set_code?: string;
  card_name?: string;
};

type DefectLevel = "none" | "minor" | "moderate" | "severe";

type DefectFlags = {
  centering: DefectLevel;
  corners: DefectLevel;
  edges: DefectLevel;
  surface: DefectLevel;
  structural_damage: DefectLevel;
};

type AnalysisResponse = {
  ocr_text: string;
  card_details: {
    card_name?: string;
    set?: string;
    card_number?: string;
    rarity?: string;
    game_type?: string;
  };
  condition: {
    grade_estimate: { min: number; max: number; confidence: number };
    condition_notes: string[];
    defect_flags: DefectFlags;
    recommended_action: string;
  };
  labels: string[];
};

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not set");
    }

    // Rate limit: extract user from auth header
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await sb.auth.getUser();
      if (user) {
        const rl = rateLimitResponse(user.id, "analyze-card-full", corsHeaders, 20, 60_000);
        if (rl) return rl;
      }
    }

    const body: RequestBody = await req.json();
    let image_url: string;

    try {
      image_url = validateImageUrl(body.image_url);
    } catch (e) {
      if (e instanceof SSRFError) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw e;
    }

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: "Missing image_url" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Convert expired signed URLs to public URLs (card-images bucket is public)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    if (image_url.includes("/storage/v1/object/sign/")) {
      const match = image_url.match(/\/storage\/v1\/object\/sign\/([^?]+)/);
      if (match) {
        image_url = `${SUPABASE_URL}/storage/v1/object/public/${match[1]}`;
        console.log(`Converted signed URL to public: ${image_url}`);
      }
    }

    console.log(`Analyzing card image: ${image_url}`);

    // Use Lovable AI with vision-capable model
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this trading card image and provide detailed information in JSON format:

{
  "ocr_text": "All visible text on the card extracted via OCR",
  "card_details": {
    "card_name": "Name of the card/character",
    "set": "Set name if visible",
    "card_number": "Card number (e.g., 25/102 for Pokemon, LART-EN035 for Yu-Gi-Oh)",
    "rarity": "REQUIRED - See rarity detection rules below",
    "game_type": "Pokemon/Magic/YuGiOh/Sports/etc"
  },
  "condition": {
    "grade_estimate": {
      "min": 7,
      "max": 9,
      "confidence": 0.8
    },
    "condition_notes": ["List specific condition observations"],
    "defect_flags": {
      "centering": "none/minor/moderate/severe",
      "corners": "none/minor/moderate/severe",
      "edges": "none/minor/moderate/severe",
      "surface": "none/minor/moderate/severe",
      "structural_damage": "none/minor/moderate/severe"
    },
    "recommended_action": "Recommendation based on condition"
  },
  "labels": ["descriptive", "keywords", "about", "the", "card"]
}

RARITY DETECTION - ALWAYS IDENTIFY RARITY:
- Pokemon: Look for rarity symbol bottom right (Circle=Common, Diamond=Uncommon, Star=Rare, Star H=Holo Rare, Rainbow/Full Art/Secret Rare for special cards)
- Yu-Gi-Oh: Common, Rare (silver name), Super Rare (holo image), Ultra Rare (gold name+holo), Secret Rare (diagonal pattern), Ultimate Rare (embossed), Ghost Rare, Starlight Rare
- MTG: Common (black set symbol), Uncommon (silver), Rare (gold), Mythic Rare (orange)
- Sports: Base, Rookie Card (RC), Parallel, Refractor, Prizm, Auto, Numbered (/25, /99, etc.), 1/1
- If you see holographic/prismatic effects, special borders, or serial numbers - it's NOT Common
- NEVER return null for rarity - always make your best determination

CRITICAL FOR YU-GI-OH CARDS — ROI-BASED DETECTION (NO GUESSING):

STEP 1 — REGIONS OF INTEREST:
A. Set Code Region: Crop bottom 18-25% vertically, then isolate rightmost 30-40% horizontally. The set code is in small text directly ABOVE the copyright line, right-aligned near the card border.
B. Edition Region: Crop bottom 35-50% vertically, then isolate leftmost 30-40% horizontally. The edition marker appears below the artwork frame, left-aligned.

STEP 2 — SET CODE EXTRACTION:
Strict regex: \\b[A-Z0-9]{2,5}-[A-Z]{0,2}[0-9]{3}\\b
Valid: LOB-001, SDK-003, MRD-EN045, MP23-EN001, BLMR-EN045
Rules: MUST contain hyphen, MUST end in exactly 3 digits. Extract ONLY the first valid match in the Set Code Region. If no match → "Not Detected"

STEP 3 — EDITION DETECTION:
Search ONLY within Edition Region for exact case-sensitive string "1st Edition".
Do NOT accept: "First Edition", "1st Ed", "1st", or partial text.
If found → edition = "1st Edition". If NOT found → edition = "Unlimited".

STEP 4 — DO NOT CONFUSE WITH:
Ignore: Card name (top center), attribute icon (top right), ATK/DEF (bottom right large font), serial number inside artwork box, holographic square stamp (older prints). Set code is ALWAYS above the copyright line. Edition stamp is below artwork frame on lower-left.

Also look for the 8-digit passcode number (e.g., "89631139") to confirm card identity.

Be thorough with OCR extraction. Analyze card condition carefully. Grade estimate should be PSA-style (1-10 scale).`
              },
              {
                type: "image_url",
                image_url: {
                  url: image_url
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" }
      }),
    });

    // Fallback to OpenAI vision (gpt-5-mini) if Gemini fails with 429/5xx
    let finalResponse = aiResponse;
    if (!aiResponse.ok && (aiResponse.status === 429 || aiResponse.status >= 500)) {
      const errText = await aiResponse.text().catch(() => "");
      console.warn(`Gemini vision failed (${aiResponse.status}): ${errText}. Falling back to gpt-5-mini.`);
      finalResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5-mini",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `Analyze this trading card image and return the SAME JSON shape as before (ocr_text, card_details, condition, labels). Image: ${image_url}` },
                { type: "image_url", image_url: { url: image_url } },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
      });
    }

    if (!finalResponse.ok) {
      const errorText = await finalResponse.text();
      console.error("AI gateway error:", finalResponse.status, errorText);
      throw new Error(`AI analysis failed: ${finalResponse.status}`);
    }

    const aiResult = await finalResponse.json();
    const content = aiResult.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error("No response from AI");
    }

    let analysis: AnalysisResponse;
    try {
      analysis = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Invalid AI response format");
    }

    console.log("Card analysis complete");

    // Format response to match expected FullCardAnalysis structure
    const response = {
      success: true,
      image_url,
      card_id: null,
      game: analysis.card_details?.game_type || null,
      set_code: analysis.card_details?.card_number || null,
      card_name: analysis.card_details?.card_name || null,
      vision: {
        ocr_text: analysis.ocr_text || "",
        ocr_locale: null,
        crop_hint: null,
        image_properties: null,
        labels: (analysis.labels || []).map((label: string) => ({
          description: label,
          score: 1.0,
          topicality: 1.0
        })),
        logos: [],
        web_detection: {
          entities: [],
          similar_images: [],
          matching_images: []
        },
        raw_vision_response: null
      },
      card_details: analysis.card_details || {},
      condition_estimate: {
        card_id: null,
        game: analysis.card_details?.game_type || null,
        set_code: analysis.card_details?.card_number || null,
        card_name: analysis.card_details?.card_name || null,
        raw_grade_estimate: analysis.condition?.grade_estimate || { min: 5, max: 8, confidence: 0.5 },
        condition_notes: analysis.condition?.condition_notes || [],
        defect_flags: analysis.condition?.defect_flags || {
          centering: "minor",
          corners: "minor",
          edges: "minor",
          surface: "none",
          structural_damage: "none"
        },
        recommended_action: analysis.condition?.recommended_action || "Card appears to be in good condition",
        analyzed_at: new Date().toISOString()
      }
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error: any) {
    console.error("analyze-card-full error:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal error",
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
