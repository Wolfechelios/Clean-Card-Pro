import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { collectionSummary } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Analyzing collection:", JSON.stringify(collectionSummary).slice(0, 500));

    const systemPrompt = `You are an expert trading card collection advisor and market analyst. Your goal is to help collectors maximize their collection's value through strategic buying, selling, grading, and holding decisions.

Analyze the collection data provided and give actionable, specific advice. Consider:
1. Market trends and timing
2. Grading opportunities (which cards would benefit from PSA/BGS grading)
3. Cards to hold vs sell
4. Undervalued cards to look for
5. Portfolio diversification
6. Risk management

Be specific with card names and sets when making recommendations. Format your response with clear sections using emojis for visual appeal. Keep advice practical and actionable.`;

    const userPrompt = `Analyze this trading card collection and provide strategic advice to increase its value:

**Collection Overview:**
- Total Cards: ${collectionSummary.totalCards}
- Total Value: $${collectionSummary.totalValue}
- Average Card Value: $${collectionSummary.avgCardValue}

**Top 20 Most Valuable Cards:**
${collectionSummary.topCards.map((c: any, i: number) => `${i + 1}. ${c.name} (${c.set}) - $${c.value?.toFixed(2) || '0.00'} - ${c.rarity || 'Unknown rarity'}`).join('\n')}

**Low Value Cards (under $5):**
${collectionSummary.lowValueCards.slice(0, 10).map((c: any) => `- ${c.name} (${c.set}) - $${c.value?.toFixed(2) || '0.00'}`).join('\n')}

**Rarity Distribution:**
${Object.entries(collectionSummary.rarityDistribution).map(([r, c]) => `- ${r}: ${c} cards`).join('\n')}

**Top Sets in Collection:**
${collectionSummary.topSets.map(([set, count]: [string, number]) => `- ${set}: ${count} cards`).join('\n')}

Provide specific, actionable advice including:
1. 🎯 **Immediate Actions** - What should I do right now?
2. 💎 **Grading Candidates** - Which cards should I send for grading?
3. 📈 **Hold Recommendations** - Which cards have growth potential?
4. 💰 **Sell Considerations** - Any cards that might be at peak value?
5. 🔍 **Acquisition Targets** - Cards to look for that complement this collection
6. ⚠️ **Risk Assessment** - Any concerns about the collection composition?`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const advice = data.choices?.[0]?.message?.content;

    if (!advice) {
      throw new Error("No advice generated from AI");
    }

    console.log("AI advice generated successfully");

    return new Response(
      JSON.stringify({ advice }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Collection advisor error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
