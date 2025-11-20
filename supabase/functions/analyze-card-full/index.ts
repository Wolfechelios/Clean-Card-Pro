// supabase/functions/analyze-card-full/index.ts
// Full card analysis using Lovable AI (Gemini 2.5 Flash with vision)
// No external billing required!

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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

    const body: RequestBody = await req.json();
    const { image_url } = body;

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: "Missing image_url" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
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
    "card_number": "Card number (e.g., 25/102)",
    "rarity": "Rarity symbol or indicator",
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

CRITICAL FOR YU-GI-OH CARDS:
- The 8-digit passcode is located DIRECTLY BELOW the card artwork/image
- When facing the card, it's on the RIGHT side, just under the image
- This number is the MOST IMPORTANT identifier - it's unique to each Yu-Gi-Oh card
- Example: "38350296" (exactly 8 digits, no letters)
- Include this passcode in the card_number field
- Look at the right side, immediately below the artwork

Be thorough with OCR extraction, especially for Yu-Gi-Oh passcodes in that specific location. Analyze card condition carefully looking at centering, corners, edges, surface quality, and any damage. Grade estimate should be PSA-style (1-10 scale).`
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

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Lovable AI error:", aiResponse.status, errorText);
      throw new Error(`AI analysis failed: ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json();
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

    // Format response to match expected structure
    const response = {
      success: true,
      image_url,
      vision: {
        ocr_text: analysis.ocr_text || "",
        labels: analysis.labels || [],
        dominant_colors: [],
        crop_hints: []
      },
      card_details: analysis.card_details || {},
      condition: {
        raw_grade_estimate: analysis.condition?.grade_estimate || { min: 5, max: 8, confidence: 0.5 },
        condition_notes: analysis.condition?.condition_notes || [],
        defect_flags: analysis.condition?.defect_flags || {
          centering: "minor",
          corners: "minor",
          edges: "minor",
          surface: "none",
          structural_damage: "none"
        },
        recommended_action: analysis.condition?.recommended_action || "Card appears to be in good condition"
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
