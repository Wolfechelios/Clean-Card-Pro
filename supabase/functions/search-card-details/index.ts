import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { card_name, game_type } = await req.json();

    if (!card_name) {
      return new Response(JSON.stringify({ error: "Missing card_name" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Searching TCGPlayer for: "${card_name}" (${game_type || "yugioh"})`);

    // Determine TCGPlayer category
    const gameMap: Record<string, string> = {
      yugioh: "yugioh",
      "yu-gi-oh": "yugioh",
      "yu-gi-oh!": "yugioh",
      pokemon: "pokemon",
      pokémon: "pokemon",
      mtg: "magic-the-gathering",
      magic: "magic-the-gathering",
    };
    const category = gameMap[(game_type || "yugioh").toLowerCase()] || "yugioh";

    // Search TCGPlayer's internal API
    const searchUrl = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(card_name)}&isList=false`;

    const searchResponse = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      body: JSON.stringify({
        algorithm: "",
        from: 0,
        size: 10,
        filters: {
          term: {
            productLineName: [category === "yugioh" ? "yugioh" : category],
          },
          range: {},
          match: {},
        },
        listingSearch: {
          filters: { term: {}, range: {}, exclude: { channelExclusion: 0 } },
        },
        context: { cart: {}, shippingCountry: "US" },
        sort: { field: "relevance", order: "desc" },
      }),
    });

    if (!searchResponse.ok) {
      console.error("TCGPlayer search failed:", searchResponse.status);
      throw new Error(`TCGPlayer search returned ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const results = searchData?.results?.[0]?.results || [];

    if (results.length === 0) {
      return new Response(
        JSON.stringify({ success: true, matches: [], message: "No matches found on TCGPlayer" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract relevant info from top results
    const matches = results.slice(0, 5).map((r: any) => {
      const setName = r.setName || r.groupName || null;
      const cardNumber = r.customAttributes?.number || r.extNumber || null;
      const rarity = r.rarityName || r.customAttributes?.rarity || null;
      const name = r.productName || r.name || card_name;
      const productId = r.productId || null;
      const marketPrice = r.marketPrice || r.lowestPrice || null;

      return {
        card_name: name,
        card_set: setName,
        card_number: cardNumber,
        rarity,
        market_price: marketPrice,
        product_id: productId,
        tcgplayer_url: productId ? `https://www.tcgplayer.com/product/${productId}` : null,
      };
    });

    console.log(`Found ${matches.length} matches for "${card_name}"`);

    return new Response(
      JSON.stringify({ success: true, matches }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("search-card-details error:", error);
    return new Response(
      JSON.stringify({ error: "Search failed", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
