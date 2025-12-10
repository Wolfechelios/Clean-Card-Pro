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

    const { analyticsType } = await req.json();
    // analyticsType: "collection" | "market" | "grading"

    // Fetch all user's cards
    const { data: cards, error: cardsError } = await supabaseClient
      .from("cards")
      .select("*")
      .eq("user_id", user.id);

    if (cardsError) {
      console.error("Error fetching cards:", cardsError);
      return new Response(JSON.stringify({ error: "Failed to fetch cards" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch price history for trends
    const { data: priceHistory } = await supabaseClient
      .from("price_history")
      .select("*")
      .order("recorded_at", { ascending: false })
      .limit(500);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate base statistics
    const totalCards = cards?.length || 0;
    const totalValue = cards?.reduce((sum, c) => sum + (c.current_price_raw || 0), 0) || 0;
    const avgValue = totalCards > 0 ? totalValue / totalCards : 0;

    const rarityDistribution: Record<string, number> = {};
    const setDistribution: Record<string, number> = {};
    const gameDistribution: Record<string, number> = {};
    const conditionDistribution: Record<string, number> = {};

    cards?.forEach((card) => {
      const rarity = card.rarity || "Unknown";
      const set = card.card_set || "Unknown";
      const game = card.game_type || card.sport_type || "Unknown";
      const condition = card.condition || "Ungraded";

      rarityDistribution[rarity] = (rarityDistribution[rarity] || 0) + 1;
      setDistribution[set] = (setDistribution[set] || 0) + 1;
      gameDistribution[game] = (gameDistribution[game] || 0) + 1;
      conditionDistribution[condition] = (conditionDistribution[condition] || 0) + 1;
    });

    // Top valuable cards
    const topCards = [...(cards || [])]
      .sort((a, b) => (b.current_price_raw || 0) - (a.current_price_raw || 0))
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        name: c.card_name,
        set: c.card_set,
        value: c.current_price_raw,
        rarity: c.rarity,
      }));

    let prompt = "";
    let systemPrompt = "";

    if (analyticsType === "collection") {
      systemPrompt = `You are an expert trading card collection analyst. Provide detailed insights about collection composition, value concentration, completion progress, and optimization recommendations.`;
      prompt = `Analyze this trading card collection and provide comprehensive insights:

Collection Statistics:
- Total Cards: ${totalCards}
- Total Value: $${totalValue.toFixed(2)}
- Average Card Value: $${avgValue.toFixed(2)}

Rarity Distribution:
${Object.entries(rarityDistribution).map(([r, c]) => `- ${r}: ${c} cards`).join("\n")}

Set Distribution (top 10):
${Object.entries(setDistribution).slice(0, 10).map(([s, c]) => `- ${s}: ${c} cards`).join("\n")}

Game/Sport Distribution:
${Object.entries(gameDistribution).map(([g, c]) => `- ${g}: ${c} cards`).join("\n")}

Top 10 Most Valuable:
${topCards.map((c, i) => `${i + 1}. ${c.name} - $${c.value?.toFixed(2) || "N/A"}`).join("\n")}

Return JSON:
{
  "overview": {
    "collectionHealth": "excellent" | "good" | "average" | "needs_attention",
    "diversificationScore": 0-100,
    "valueConcentration": "high" | "medium" | "low",
    "summary": "string"
  },
  "strengths": ["string"],
  "weaknesses": ["string"],
  "completionProgress": [
    { "setName": "string", "owned": number, "estimated_total": number, "completion": 0-100 }
  ],
  "recommendations": [
    { "type": "buy" | "sell" | "trade" | "hold", "description": "string", "priority": "high" | "medium" | "low" }
  ]
}`;
    } else if (analyticsType === "market") {
      systemPrompt = `You are an expert trading card market analyst with deep knowledge of price trends, market volatility, and investment opportunities across all card types.`;
      
      // Calculate price changes
      const priceChanges = cards?.map((card) => {
        const history = priceHistory?.filter((h) => h.card_id === card.id) || [];
        if (history.length < 2) return null;
        const latest = history[0]?.price_raw || 0;
        const oldest = history[history.length - 1]?.price_raw || 0;
        const change = oldest > 0 ? ((latest - oldest) / oldest) * 100 : 0;
        return { card, change };
      }).filter(Boolean);

      const gainers = priceChanges?.filter((p) => p && p.change > 0).sort((a, b) => (b?.change || 0) - (a?.change || 0)).slice(0, 5);
      const losers = priceChanges?.filter((p) => p && p.change < 0).sort((a, b) => (a?.change || 0) - (b?.change || 0)).slice(0, 5);

      prompt = `Analyze market trends for this trading card collection:

Collection Value: $${totalValue.toFixed(2)}
Total Cards: ${totalCards}

Top Gainers:
${gainers?.map((g) => `- ${g?.card.card_name}: +${g?.change.toFixed(1)}%`).join("\n") || "No data"}

Top Losers:
${losers?.map((l) => `- ${l?.card.card_name}: ${l?.change.toFixed(1)}%`).join("\n") || "No data"}

Game Distribution:
${Object.entries(gameDistribution).map(([g, c]) => `- ${g}: ${c} cards`).join("\n")}

Provide market analysis with current trends, volatility assessment, and timing recommendations.

Return JSON:
{
  "marketOverview": {
    "trend": "bullish" | "bearish" | "stable",
    "volatility": "high" | "medium" | "low",
    "summary": "string"
  },
  "trendingCategories": [
    { "category": "string", "trend": "up" | "down" | "stable", "momentum": 0-100 }
  ],
  "priceMovers": {
    "gainers": [{ "cardName": "string", "changePercent": number, "reason": "string" }],
    "losers": [{ "cardName": "string", "changePercent": number, "reason": "string" }]
  },
  "timingRecommendations": [
    { "action": "buy" | "sell" | "hold", "category": "string", "reasoning": "string", "urgency": "high" | "medium" | "low" }
  ]
}`;
    } else if (analyticsType === "grading") {
      systemPrompt = `You are an expert trading card grading consultant with deep knowledge of PSA, CGC, and Beckett grading standards. Analyze cards for grading potential and value uplift.`;

      const ungradedCards = cards?.filter((c) => !c.condition || c.condition === "ungraded" || c.condition === "raw");
      const gradedCards = cards?.filter((c) => c.condition && c.condition !== "ungraded" && c.condition !== "raw");

      prompt = `Analyze this collection for grading opportunities:

Total Cards: ${totalCards}
Ungraded Cards: ${ungradedCards?.length || 0}
Graded Cards: ${gradedCards?.length || 0}

Condition Distribution:
${Object.entries(conditionDistribution).map(([c, n]) => `- ${c}: ${n} cards`).join("\n")}

Top Value Ungraded Cards:
${ungradedCards?.sort((a, b) => (b.current_price_raw || 0) - (a.current_price_raw || 0)).slice(0, 10).map((c) => `- ${c.card_name} (${c.card_set}): $${c.current_price_raw?.toFixed(2) || "N/A"}, Rarity: ${c.rarity}`).join("\n") || "None"}

Graded Cards (PSA 9+):
${gradedCards?.filter((c) => c.current_price_psa9 || c.current_price_psa10).slice(0, 5).map((c) => `- ${c.card_name}: PSA9 $${c.current_price_psa9?.toFixed(2) || "N/A"}, PSA10 $${c.current_price_psa10?.toFixed(2) || "N/A"}`).join("\n") || "None"}

Analyze grading potential and ROI.

Return JSON:
{
  "gradingOverview": {
    "gradedPercentage": number,
    "potentialUplift": number,
    "recommendedSubmissions": number,
    "summary": "string"
  },
  "gradeDistribution": {
    "psa10": number,
    "psa9": number,
    "psa8andBelow": number,
    "ungraded": number
  },
  "topGradingCandidates": [
    {
      "cardId": "string",
      "cardName": "string",
      "currentValue": number,
      "estimatedPSA9Value": number,
      "estimatedPSA10Value": number,
      "upliftPotential": number,
      "gradingPriority": "high" | "medium" | "low",
      "reasoning": "string"
    }
  ],
  "gradingServiceRecommendation": {
    "service": "PSA" | "CGC" | "Beckett",
    "reason": "string",
    "estimatedCost": number,
    "estimatedTurnaround": "string"
  }
}`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      }),
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
    let analysis;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      analysis = JSON.parse(jsonStr);
    } catch {
      analysis = { raw: content, parseError: true };
    }

    return new Response(
      JSON.stringify({
        success: true,
        analyticsType,
        stats: {
          totalCards,
          totalValue,
          avgValue,
          rarityDistribution,
          setDistribution,
          gameDistribution,
          conditionDistribution,
          topCards,
        },
        analysis,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("advanced-analytics error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
