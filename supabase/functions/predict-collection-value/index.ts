import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { callAIGateway } from "../_shared/aiGateway.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CollectionData {
  totalCards: number;
  totalValue: number;
  gameTypeBreakdown: Record<string, { count: number; value: number }>;
  rarityBreakdown: Record<string, { count: number; value: number }>;
  topCards: Array<{
    name: string;
    set?: string;
    rarity?: string;
    value?: number;
    gameType?: string;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const collectionData = await req.json() as CollectionData;

    console.log("Predicting collection value for", collectionData.totalCards, "cards worth $", collectionData.totalValue);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Build context for AI analysis
    const gameTypeContext = Object.entries(collectionData.gameTypeBreakdown)
      .map(([type, data]) => `${type}: ${data.count} cards, $${data.value.toFixed(2)} total`)
      .join('\n');

    const rarityContext = Object.entries(collectionData.rarityBreakdown)
      .map(([rarity, data]) => `${rarity}: ${data.count} cards, $${data.value.toFixed(2)} total`)
      .join('\n');

    const topCardsContext = collectionData.topCards
      .map((c, i) => `${i + 1}. ${c.name} (${c.set || 'Unknown set'}) - ${c.rarity || 'Unknown'} - $${c.value?.toFixed(2) || 'N/A'}`)
      .join('\n');

    const prompt = `You are an expert trading card portfolio analyst with deep knowledge of sports cards, TCG, Pokémon, Yu-Gi-Oh!, and MTG markets.

Analyze this card collection and predict its future value trajectory:

COLLECTION OVERVIEW:
- Total Cards: ${collectionData.totalCards}
- Total Current Value: $${collectionData.totalValue.toFixed(2)}
- Average Card Value: $${(collectionData.totalValue / Math.max(collectionData.totalCards, 1)).toFixed(2)}

GAME/SPORT TYPE BREAKDOWN:
${gameTypeContext || 'No breakdown available'}

RARITY BREAKDOWN:
${rarityContext || 'No breakdown available'}

TOP 20 MOST VALUABLE CARDS:
${topCardsContext || 'No cards available'}

Provide a comprehensive collection value prediction analysis. Consider:
1. Overall market trends for each card category
2. Portfolio diversification and risk exposure
3. High-value card concentration risk
4. Category-specific market momentum
5. Upcoming events affecting multiple categories
6. Historical patterns for portfolio-level performance

You MUST respond with ONLY a valid JSON object (no markdown, no code blocks) in this exact format:
{
  "prediction": {
    "direction": "up" | "down" | "stable",
    "confidence": 0-100,
    "shortTerm": {
      "timeframe": "30 days",
      "percentChange": number,
      "predictedValue": number
    },
    "mediumTerm": {
      "timeframe": "6 months",
      "percentChange": number,
      "predictedValue": number
    },
    "longTerm": {
      "timeframe": "1 year",
      "percentChange": number,
      "predictedValue": number
    }
  },
  "breakdown": [
    {
      "category": "string (game type or sport)",
      "currentValue": number,
      "predictedChange": number (percent),
      "cardCount": number
    }
  ],
  "factors": [
    {
      "name": "string",
      "impact": "positive" | "negative" | "neutral",
      "weight": 1-10,
      "description": "string"
    }
  ],
  "riskLevel": "low" | "medium" | "high",
  "diversificationScore": 1-10,
  "summary": "2-3 sentence portfolio summary",
  "keyInsight": "One unique portfolio insight most collectors miss",
  "topGainers": ["card name 1", "card name 2", "card name 3"],
  "topLosers": ["card name 1", "card name 2", "card name 3"]
}`;

    const response = await callAIGateway({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a trading card portfolio analyst. Always respond with valid JSON only, no markdown formatting." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 2500,
      });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI API error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("AI response received, parsing...");

    // Parse the JSON response, handling potential markdown code blocks
    let prediction;
    try {
      let cleanContent = content.trim();
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent.slice(7);
      } else if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith("```")) {
        cleanContent = cleanContent.slice(0, -3);
      }
      cleanContent = cleanContent.trim();
      
      prediction = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse prediction data");
    }

    return new Response(JSON.stringify({ 
      success: true, 
      prediction,
      analyzedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Collection prediction error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to generate prediction";
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
