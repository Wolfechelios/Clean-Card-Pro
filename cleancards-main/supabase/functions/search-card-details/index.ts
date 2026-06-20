import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { card_name, game_type } = await req.json();

    if (!card_name) {
      return new Response(JSON.stringify({ error: "Missing card_name" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const game = (game_type || "yugioh").toLowerCase();
    console.log(`Searching for: "${card_name}" (${game})`);

    let matches: any[] = [];

    // Route to the right API based on game type
    if (["yugioh", "yu-gi-oh", "yu-gi-oh!", "ygo"].includes(game)) {
      matches = await searchYGOProDeck(card_name);
    } else if (["pokemon", "pokémon"].includes(game)) {
      matches = await searchPokemonTCG(card_name);
    } else {
      // Fallback: try YGOProDeck first (most cards in this app are Yu-Gi-Oh)
      matches = await searchYGOProDeck(card_name);
    }

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

// ── YGOProDeck API (free, no key required) ──────────────────────────
async function searchYGOProDeck(cardName: string): Promise<any[]> {
  try {
    // Try exact name first
    const exactUrl = `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(cardName)}`;
    let resp = await fetch(exactUrl, {
      headers: { Accept: "application/json" },
    });

    // If exact match fails, try fuzzy search
    if (!resp.ok) {
      const fuzzyUrl = `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(cardName)}`;
      resp = await fetch(fuzzyUrl, {
        headers: { Accept: "application/json" },
      });
    }

    if (!resp.ok) {
      console.warn(`YGOProDeck returned ${resp.status} for "${cardName}"`);
      return [];
    }

    const data = await resp.json();
    const cards = data?.data || [];

    // Each card can have multiple sets (card_sets array)
    const matches: any[] = [];

    for (const card of cards.slice(0, 3)) {
      const sets = card.card_sets || [];
      if (sets.length === 0) {
        // Card exists but no set info
        matches.push({
          card_name: card.name,
          card_set: null,
          card_number: null,
          rarity: card.card_sets?.[0]?.set_rarity || mapYGORarity(card),
          market_price: parseFloat(card.card_prices?.[0]?.tcgplayer_price) || null,
          product_id: null,
          tcgplayer_url: card.card_prices?.[0]?.tcgplayer_price
            ? `https://www.tcgplayer.com/search/yugioh/product?q=${encodeURIComponent(card.name)}`
            : null,
        });
      } else {
        // Add each set printing as a separate match
        for (const s of sets.slice(0, 5)) {
          matches.push({
            card_name: card.name,
            card_set: s.set_name || null,
            card_number: s.set_code || null,
            rarity: s.set_rarity || null,
            market_price: parseFloat(s.set_price) || parseFloat(card.card_prices?.[0]?.tcgplayer_price) || null,
            product_id: null,
            tcgplayer_url: `https://www.tcgplayer.com/search/yugioh/product?q=${encodeURIComponent(card.name)}`,
          });
        }
      }
    }

    return matches.slice(0, 10);
  } catch (err) {
    console.error("YGOProDeck search error:", err);
    return [];
  }
}

function mapYGORarity(card: any): string | null {
  const type = (card.type || "").toLowerCase();
  if (type.includes("normal")) return "Common";
  if (type.includes("effect")) return "Common";
  return null;
}

// ── Pokémon TCG API (free, no key required) ─────────────────────────
async function searchPokemonTCG(cardName: string): Promise<any[]> {
  try {
    const url = `https://api.pokemontcg.io/v2/cards?q=name:"${encodeURIComponent(cardName)}"&pageSize=10`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      console.warn(`PokemonTCG API returned ${resp.status}`);
      return [];
    }

    const data = await resp.json();
    const cards = data?.data || [];

    return cards.slice(0, 10).map((c: any) => ({
      card_name: c.name,
      card_set: c.set?.name || null,
      card_number: c.number || null,
      rarity: c.rarity || null,
      market_price: c.tcgplayer?.prices?.holofoil?.market
        || c.tcgplayer?.prices?.normal?.market
        || c.tcgplayer?.prices?.reverseHolofoil?.market
        || null,
      product_id: null,
      tcgplayer_url: c.tcgplayer?.url || null,
    }));
  } catch (err) {
    console.error("PokemonTCG search error:", err);
    return [];
  }
}
