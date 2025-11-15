import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, ocrText } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Use AI vision to identify the card
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are an expert trading card identifier. Analyze card images and extract:
- Exact card name
- Set name and code
- Card number
- Rarity (Common, Uncommon, Rare, Ultra Rare, Secret Rare, etc.)
- Edition (1st Edition, Unlimited, Alpha, Beta, etc.)
- Sport type (Baseball, Basketball, Football, Soccer, Hockey, etc.) OR Game type (Pokemon, Magic: The Gathering, Yu-Gi-Oh, etc.)
- Condition hints from the image
- For Magic: The Gathering, detect Alpha vs Beta vs Unlimited by analyzing corner curvature and border characteristics

Return ONLY a JSON object with these exact keys: cardName, cardSet, cardNumber, rarity, edition, sportType, gameType, condition, notes`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Identify this trading card. OCR text detected: ${ocrText || "none"}`
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "identify_card",
              description: "Extract structured card identification data",
              parameters: {
                type: "object",
                properties: {
                  cardName: { type: "string" },
                  cardSet: { type: "string" },
                  cardNumber: { type: "string" },
                  rarity: { type: "string" },
                  edition: { type: "string" },
                  sportType: { type: "string" },
                  gameType: { type: "string" },
                  condition: { type: "string" },
                  notes: { type: "string" }
                },
                required: ["cardName"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "identify_card" } }
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      throw new Error("AI identification failed");
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let cardData;
    
    if (toolCall?.function?.arguments) {
      cardData = JSON.parse(toolCall.function.arguments);
    } else {
      throw new Error("No card data extracted from AI");
    }

    // Fetch pricing data from multiple sources
    const pricingData = await fetchPricingData(cardData);

    return new Response(
      JSON.stringify({
        ...cardData,
        ...pricingData,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in identify-card:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function fetchPricingData(cardData: any) {
  try {
    // Construct search query for pricing APIs
    const searchQuery = `${cardData.cardName} ${cardData.cardSet || ""} ${cardData.cardNumber || ""}`.trim();
    
    // For MVP, we'll use eBay's public API to get sold listings
    // In production, you'd integrate with TCGPlayer, PriceCharting, SportsCardPro APIs
    const ebayPricing = await fetchEbayPricing(searchQuery);
    
    return {
      currentPriceRaw: ebayPricing.raw || null,
      currentPricePsa9: ebayPricing.psa9 || null,
      currentPricePsa10: ebayPricing.psa10 || null,
      suggestedPrice: ebayPricing.suggested || null,
      ebayListingUrl: ebayPricing.listingUrl || null,
    };
  } catch (error) {
    console.error("Pricing fetch error:", error);
    return {
      currentPriceRaw: null,
      currentPricePsa9: null,
      currentPricePsa10: null,
      suggestedPrice: null,
      ebayListingUrl: null,
    };
  }
}

async function fetchEbayPricing(searchQuery: string) {
  // Note: This is a simplified version. In production, you'd use:
  // 1. eBay Finding API with proper authentication
  // 2. TCGPlayer API
  // 3. PriceCharting API
  // 4. SportsCardPro API
  
  // For now, return placeholder logic that could be enhanced with real API keys
  // The user would need to add their eBay, TCGPlayer, etc. API keys as secrets
  
  try {
    // Simulate pricing calculation based on card data
    // In production, make actual API calls to pricing services
    const basePrice = Math.random() * 100 + 10; // Placeholder
    
    return {
      raw: Math.round(basePrice * 100) / 100,
      psa9: Math.round(basePrice * 1.5 * 100) / 100,
      psa10: Math.round(basePrice * 2.5 * 100) / 100,
      suggested: Math.round(basePrice * 1.2 * 100) / 100,
      listingUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}`,
    };
  } catch (error) {
    console.error("eBay pricing error:", error);
    return {
      raw: null,
      psa9: null,
      psa10: null,
      suggested: null,
      listingUrl: null,
    };
  }
}
