import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAIGateway } from "../_shared/aiGateway.ts";
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { imageUrl, mode, cardId } = await req.json();
    // mode: "duplicates" | "similar" | "database"

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user's cards for comparison
    const { data: userCards, error: cardsError } = await supabaseClient
      .from("cards")
      .select("id, card_name, card_set, card_number, image_url, rarity, current_price_raw")
      .eq("user_id", user.id);

    if (cardsError) {
      console.error("Error fetching cards:", cardsError);
      return new Response(JSON.stringify({ error: "Failed to fetch cards" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let prompt = "";
    let systemPrompt = "";

    if (mode === "duplicates") {
      systemPrompt = `You are an expert trading card analyst specializing in duplicate detection. Analyze the provided card image and compare it against the user's collection to identify potential duplicates.`;
      prompt = `Analyze this card image and compare it to the user's collection to find duplicates.

User's collection (${userCards?.length || 0} cards):
${userCards?.map(c => `- ${c.card_name} (Set: ${c.card_set}, #${c.card_number})`).join("\n") || "No cards"}

Look for:
1. Exact duplicates (same card name, set, and number)
2. Near duplicates (same card, different condition/edition)
3. Variant duplicates (same card, different art/foil)

Return JSON:
{
  "duplicates": [
    {
      "cardId": "uuid",
      "cardName": "string",
      "matchType": "exact" | "near" | "variant",
      "confidence": 0-100,
      "reason": "string"
    }
  ],
  "summary": "string"
}`;
    } else if (mode === "similar") {
      systemPrompt = `You are an expert trading card analyst. Analyze cards to find visually and thematically similar cards based on artwork, player, character, or design elements.`;
      prompt = `Analyze this card image and find similar cards in the collection based on:
- Similar artwork style or theme
- Same player/character/creature type
- Similar design elements
- Related set or series

User's collection:
${userCards?.map(c => `- ID: ${c.id}, ${c.card_name} (Set: ${c.card_set})`).join("\n") || "No cards"}

Return JSON:
{
  "similarCards": [
    {
      "cardId": "uuid",
      "cardName": "string",
      "similarityType": "artwork" | "character" | "theme" | "series",
      "similarityScore": 0-100,
      "reason": "string"
    }
  ],
  "summary": "string"
}`;
    } else if (mode === "database") {
      systemPrompt = `You are an expert trading card identifier with comprehensive knowledge of all trading card games, sports cards, and collectible cards. Identify unknown cards by analyzing visual elements.`;
      prompt = `Analyze this card image and identify it by comparing against known card databases.

Extract and match:
1. Card name and number
2. Set/expansion name
3. Year of release
4. Rarity and edition
5. Game type (Pokemon, Yu-Gi-Oh, MTG, Sports, etc.)

Return JSON:
{
  "identifiedCard": {
    "cardName": "string",
    "setName": "string",
    "cardNumber": "string",
    "year": "string",
    "rarity": "string",
    "gameType": "string",
    "confidence": 0-100
  },
  "alternativeMatches": [
    {
      "cardName": "string",
      "setName": "string",
      "confidence": 0-100
    }
  ],
  "visualClues": ["string"],
  "summary": "string"
}`;
    }

    const response = await callAIGateway({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        temperature: 0.3,
      });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI API error:", errorText);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let result;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      result = JSON.parse(jsonStr);
    } catch {
      result = { raw: content, parseError: true };
    }

    return new Response(
      JSON.stringify({
        success: true,
        mode,
        result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("visual-similarity error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
