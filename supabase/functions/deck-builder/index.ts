import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface DeckCard {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  game_type: string | null;
  current_price_raw: number | null;
  current_price_psa10: number | null;
  image_url: string;
  quantity: number;
}

interface DeckBuilderRequest {
  mode: "value" | "battle";
  gameType: string;
  setFilter?: string;
  deckSize?: number;
  useCollectionOnly: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
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

    const { mode, gameType, setFilter, deckSize = 60, useCollectionOnly } = await req.json() as DeckBuilderRequest;

    console.log(`Building ${mode} deck for ${gameType}, set: ${setFilter || "all"}, collection only: ${useCollectionOnly}`);

    // Fetch user's collection cards for the specified game type
    let query = supabaseClient
      .from("cards")
      .select("id, card_name, card_set, card_number, rarity, game_type, current_price_raw, current_price_psa10, image_url, quantity")
      .eq("user_id", user.id);

    if (gameType && gameType !== "all") {
      query = query.eq("game_type", gameType);
    }

    if (setFilter) {
      query = query.ilike("card_set", `%${setFilter}%`);
    }

    const { data: cards, error: cardsError } = await query;

    if (cardsError) {
      console.error("Error fetching cards:", cardsError);
      throw new Error("Failed to fetch collection");
    }

    const collectionCards = (cards || []) as DeckCard[];

    // Build context for AI
    const collectionSummary = collectionCards.map(c => ({
      name: c.card_name,
      set: c.card_set || "Unknown Set",
      number: c.card_number,
      rarity: c.rarity || "Unknown",
      price: c.current_price_raw || 0,
      psa10Price: c.current_price_psa10 || 0,
      qty: c.quantity || 1
    }));

    const totalValue = collectionCards.reduce((sum, c) => sum + ((c.current_price_raw || 0) * (c.quantity || 1)), 0);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Different prompts based on mode
    const systemPrompt = mode === "value" 
      ? `You are an expert TCG collection analyst and deck builder. Your goal is to build decks that maximize monetary value.
Focus on:
1. High-value cards that work well together
2. Rare and sought-after cards
3. Cards with appreciation potential
4. Complete sets or chase cards that add premium value
5. PSA 10 potential cards`
      : `You are an expert competitive TCG deck builder. Your goal is to build powerful, tournament-viable decks.
Focus on:
1. Meta-relevant strategies and win conditions
2. Card synergies and combos
3. Consistency with draw power and search cards
4. Strong removal and disruption
5. Proper ratios (monsters/spells/traps or creatures/lands/spells depending on game)`;

    const gameRules: Record<string, string> = {
      "Yu-Gi-Oh!": "40-60 cards main deck, 15 card extra deck (Fusion/Synchro/Xyz/Link), 15 card side deck. Max 3 copies per card except limited/semi-limited.",
      "MTG": "60 cards minimum, typically 24 lands, 36 non-lands. Max 4 copies per card (except basic lands).",
      "Pokemon": "60 cards exactly. Max 4 copies per card (except basic energy). Need Pokemon, Trainers, and Energy.",
      "all": "Build a deck following standard TCG conventions for the cards available."
    };

    const userPrompt = `Build a ${mode === "value" ? "maximum value" : "competitive battle"} deck from the following collection.

**Game Type:** ${gameType}
**Deck Rules:** ${gameRules[gameType] || gameRules["all"]}
**Target Deck Size:** ${deckSize} cards
**Use Collection Only:** ${useCollectionOnly ? "Yes - only use cards from the collection below" : "No - you can suggest cards to acquire"}

**Collection (${collectionCards.length} unique cards, $${totalValue.toFixed(2)} total value):**
${collectionSummary.slice(0, 100).map((c, i) => 
  `${i+1}. ${c.name} (${c.set}${c.number ? ` #${c.number}` : ""}) - ${c.rarity} - $${c.price.toFixed(2)} raw${c.psa10Price ? `, $${c.psa10Price.toFixed(2)} PSA10` : ""} - Qty: ${c.qty}`
).join("\n")}
${collectionSummary.length > 100 ? `\n... and ${collectionSummary.length - 100} more cards` : ""}

You MUST respond with ONLY valid JSON (no markdown) in this exact format:
{
  "deckName": "string - creative name for the deck",
  "strategy": "string - 2-3 sentence deck strategy explanation",
  "mainDeck": [
    {
      "cardName": "string",
      "quantity": number,
      "role": "string - role in deck (e.g., 'win condition', 'removal', 'draw power')",
      "inCollection": boolean,
      "estimatedPrice": number
    }
  ],
  "extraDeck": [/* same format, for games that have extra deck */],
  "sideDeck": [/* same format, optional suggestions */],
  "totalValue": number,
  "valuePotential": "string - value appreciation analysis",
  "competitiveRating": "casual" | "locals" | "regional" | "meta",
  "cardsToAcquire": [
    {
      "cardName": "string",
      "reason": "string",
      "estimatedPrice": number,
      "priority": "must-have" | "recommended" | "optional"
    }
  ],
  "synergies": ["string - key synergies in the deck"],
  "weaknesses": ["string - deck weaknesses to be aware of"]
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000,
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

    console.log("AI deck builder response received");

    // Parse JSON response
    let deckBuild;
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
      
      deckBuild = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse deck build data");
    }

    // Match deck cards with collection for image URLs
    const enrichedMainDeck = deckBuild.mainDeck?.map((deckCard: any) => {
      const collectionMatch = collectionCards.find(c => 
        c.card_name.toLowerCase().includes(deckCard.cardName.toLowerCase()) ||
        deckCard.cardName.toLowerCase().includes(c.card_name.toLowerCase())
      );
      return {
        ...deckCard,
        imageUrl: collectionMatch?.image_url || null,
        collectionCardId: collectionMatch?.id || null
      };
    }) || [];

    return new Response(JSON.stringify({
      success: true,
      deck: {
        ...deckBuild,
        mainDeck: enrichedMainDeck
      },
      collectionStats: {
        totalCards: collectionCards.length,
        totalValue,
        gameType
      },
      generatedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Deck builder error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Failed to build deck"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
