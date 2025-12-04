import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CardData {
  card_name: string;
  card_set?: string;
  card_number?: string;
  rarity?: string;
  game_type?: string;
  sport_type?: string;
  current_price_raw?: number;
  current_price_psa9?: number;
  current_price_psa10?: number;
}

interface PriceHistory {
  price_raw?: number;
  price_psa9?: number;
  price_psa10?: number;
  recorded_at: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { card, priceHistory } = await req.json() as { 
      card: CardData; 
      priceHistory?: PriceHistory[] 
    };

    console.log("Predicting value for card:", card.card_name);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Build context for AI analysis
    const priceHistoryContext = priceHistory?.length 
      ? priceHistory.map(p => `${p.recorded_at}: Raw=$${p.price_raw || 'N/A'}, PSA9=$${p.price_psa9 || 'N/A'}, PSA10=$${p.price_psa10 || 'N/A'}`).join('\n')
      : 'No historical price data available';

    const prompt = `You are an expert trading card market analyst with deep knowledge of sports cards, TCG, Pokémon, Yu-Gi-Oh!, and MTG markets.

Analyze this card and predict its future value trajectory:

CARD DETAILS:
- Name: ${card.card_name}
- Set: ${card.card_set || 'Unknown'}
- Card Number: ${card.card_number || 'Unknown'}
- Rarity: ${card.rarity || 'Unknown'}
- Game/Sport Type: ${card.game_type || card.sport_type || 'Unknown'}
- Current Raw Price: $${card.current_price_raw || 'Unknown'}
- Current PSA 9 Price: $${card.current_price_psa9 || 'Unknown'}
- Current PSA 10 Price: $${card.current_price_psa10 || 'Unknown'}

PRICE HISTORY:
${priceHistoryContext}

Provide a comprehensive value prediction analysis. Consider:
1. Market trends for this card type/game
2. Rarity and print run factors
3. Player/character popularity trends
4. Historical price patterns
5. Upcoming events that could affect value
6. Supply and demand dynamics

You MUST respond with ONLY a valid JSON object (no markdown, no code blocks) in this exact format:
{
  "prediction": {
    "direction": "up" | "down" | "stable",
    "confidence": 0-100,
    "shortTerm": {
      "timeframe": "30 days",
      "percentChange": number,
      "predictedRaw": number,
      "predictedPsa9": number,
      "predictedPsa10": number
    },
    "mediumTerm": {
      "timeframe": "6 months",
      "percentChange": number,
      "predictedRaw": number,
      "predictedPsa9": number,
      "predictedPsa10": number
    },
    "longTerm": {
      "timeframe": "1 year",
      "percentChange": number,
      "predictedRaw": number,
      "predictedPsa9": number,
      "predictedPsa10": number
    }
  },
  "factors": [
    {
      "name": "string",
      "impact": "positive" | "negative" | "neutral",
      "weight": 1-10,
      "description": "string"
    }
  ],
  "riskLevel": "low" | "medium" | "high",
  "investmentRating": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
  "summary": "2-3 sentence summary",
  "keyInsight": "One unique insight most collectors miss"
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a trading card market analyst. Always respond with valid JSON only, no markdown formatting." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
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
      // Remove potential markdown code blocks
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
    console.error("Prediction error:", error);
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
