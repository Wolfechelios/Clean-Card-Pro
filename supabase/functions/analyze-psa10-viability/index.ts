// Edge function to analyze card images for PSA 10 viability
// Uses Lovable AI to examine card condition and determine grading potential

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const { card_id, image_url } = await req.json();

    if (!card_id && !image_url) {
      return new Response(
        JSON.stringify({ error: "card_id or image_url required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let cardImageUrl = image_url;
    let cardData = null;

    // If card_id provided, fetch the card
    if (card_id) {
      const { data: card, error: cardError } = await supabase
        .from("cards")
        .select("*")
        .eq("id", card_id)
        .single();

      if (cardError || !card) {
        return new Response(
          JSON.stringify({ error: "Card not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      cardData = card;
      cardImageUrl = card.image_url;
    }

    if (!cardImageUrl) {
      return new Response(
        JSON.stringify({ error: "No image URL available" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Analyzing PSA 10 viability for image: ${cardImageUrl}`);

    // Use Lovable AI to analyze card condition for PSA 10 potential
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
                text: `Analyze this trading card image for PSA 10 GEM MINT potential. 

A PSA 10 requires:
- Perfect or virtually perfect centering (60/40 or better front and back)
- Sharp, undamaged corners with no wear
- Clean, crisp edges without whitening or chips
- Pristine surface with no scratches, print lines, or staining
- No structural damage (bends, creases, dents)
- Original factory gloss preserved

Examine the image carefully and respond in JSON format:

{
  "psa10_viable": true/false,
  "confidence": 0-100,
  "grade_estimate": {
    "min": 7,
    "max": 10,
    "likely": 9
  },
  "analysis": {
    "centering": "perfect/good/off-center/poor",
    "corners": "sharp/minor wear/moderate wear/damaged",
    "edges": "clean/minor whitening/chipping/damaged",
    "surface": "pristine/minor marks/scratches/damaged",
    "overall_impression": "Brief summary of condition"
  },
  "notes": "Detailed notes explaining the assessment",
  "recommended_action": "Grade immediately / Wait for price appreciation / Sell raw / Not worth grading"
}

Be strict - PSA 10 is exceptionally rare. Only cards that appear absolutely flawless should be marked as psa10_viable.
If the image quality is too low to properly assess, set confidence to under 50.`
              },
              {
                type: "image_url",
                image_url: {
                  url: cardImageUrl
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
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted, please add credits" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI analysis failed: ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json();
    const content = aiResult.choices[0]?.message?.content;

    if (!content) {
      throw new Error("No response from AI");
    }

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Invalid AI response format");
    }

    console.log("PSA 10 viability analysis complete:", analysis);

    // Update the card if card_id was provided
    if (card_id) {
      const { error: updateError } = await supabase
        .from("cards")
        .update({
          psa10_viable: analysis.psa10_viable,
          psa10_viable_confidence: analysis.confidence,
          psa10_viable_notes: analysis.notes,
          psa10_analyzed_at: new Date().toISOString()
        })
        .eq("id", card_id);

      if (updateError) {
        console.error("Failed to update card:", updateError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        psa10_viable: analysis.psa10_viable,
        confidence: analysis.confidence,
        grade_estimate: analysis.grade_estimate,
        analysis: analysis.analysis,
        notes: analysis.notes,
        recommended_action: analysis.recommended_action
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("analyze-psa10-viability error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
