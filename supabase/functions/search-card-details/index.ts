import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Match {
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  market_price: number | null;
  product_id: string | null;
  tcgplayer_url: string | null;
  image_url?: string | null;
  game?: string | null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { card_name, game_type, card_number, set_code, set_name } = await req.json();
    if (!card_name) {
      return new Response(JSON.stringify({ error: "Missing card_name" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const game = (game_type || "").toLowerCase();
    const hints = { card_number, set_code, set_name };
    console.log(`[search-card-details] "${card_name}" (${game || "any"}) hints:`, hints);

    let matches: Match[] = [];

    if (/yugioh|yu-gi-oh|ygo/.test(game)) {
      matches = await searchYGOProDeck(card_name);
    } else if (/pokemon|pokémon/.test(game)) {
      matches = await searchPokemonTCG(card_name);
    } else if (/mtg|magic/.test(game)) {
      matches = await searchScryfall(card_name, hints);
    } else {
      // Unknown game — race all 3 in parallel
      const [s, y, p] = await Promise.all([
        searchScryfall(card_name, hints).catch(() => []),
        searchYGOProDeck(card_name).catch(() => []),
        searchPokemonTCG(card_name).catch(() => []),
      ]);
      matches = [...s, ...y, ...p].slice(0, 10);
    }

    matches = rankMatches(matches, hints);

    console.log(`[search-card-details] returned ${matches.length} matches`);
    return new Response(JSON.stringify({ success: true, matches }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("search-card-details error:", error);
    return new Response(
      JSON.stringify({ error: "Search failed", details: error?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// ── Ranking by hints (number/set/image) ─────────────────────────────
interface Hints { card_number?: string | null; set_code?: string | null; set_name?: string | null }
function norm(s?: string | null) { return (s || "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""); }
function rankMatches(matches: Match[], h: Hints): Match[] {
  const num = norm(h.card_number);
  const code = norm(h.set_code);
  const setN = norm(h.set_name);
  const scored = matches.map((m) => {
    let score = 0;
    if (num && norm(m.card_number) === num) score += 5;
    else if (num && norm(m.card_number).endsWith(num)) score += 2;
    if (code && norm(m.card_number).startsWith(code)) score += 2;
    if (setN && norm(m.card_set).includes(setN)) score += 3;
    if (m.image_url) score += 1;
    if (m.market_price) score += 0.5;
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.m);
}

// ── Scryfall (MTG) ──────────────────────────────────────────────────
async function searchScryfall(cardName: string, hints?: Hints): Promise<Match[]> {
  try {
    // If we have set + collector_number hints, try the exact endpoint first
    if (hints?.set_code && hints?.card_number) {
      const code = hints.set_code.toLowerCase().replace(/[^a-z0-9]/g, "");
      const cn = hints.card_number.replace(/[^a-z0-9]/gi, "");
      try {
        const exact = await fetch(`https://api.scryfall.com/cards/${code}/${cn}`);
        if (exact.ok) {
          const c = await exact.json();
          return [scryfallToMatch(c)];
        }
      } catch { /* ignore */ }
    }

    let q = `!"${cardName}"`;
    if (hints?.set_code) q += ` set:${hints.set_code}`;
    if (hints?.card_number) q += ` cn:${hints.card_number}`;
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`;
    let resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) {
      // Broader search
      resp = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(cardName)}&unique=prints&order=released&dir=desc`,
        { headers: { Accept: "application/json" } }
      );
    }
    if (!resp.ok) {
      const named = await fetch(
        `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`
      );
      if (!named.ok) return [];
      const c = await named.json();
      return [scryfallToMatch(c)];
    }
    const data = await resp.json();
    return (data?.data || []).slice(0, 20).map(scryfallToMatch);
  } catch (e) {
    console.warn("[Scryfall] error:", e);
    return [];
  }
}

function scryfallToMatch(c: any): Match {
  return {
    card_name: c.name,
    card_set: c.set_name || null,
    card_number: c.collector_number || null,
    rarity: c.rarity ? c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1) : null,
    market_price: parseFloat(c.prices?.usd) || parseFloat(c.prices?.usd_foil) || null,
    product_id: c.tcgplayer_id ? String(c.tcgplayer_id) : (c.id || null),
    tcgplayer_url: c.purchase_uris?.tcgplayer || (c.tcgplayer_id ? `https://www.tcgplayer.com/product/${c.tcgplayer_id}` : null),
    image_url: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || null,
    game: "mtg",
  };
}

// ── YGOProDeck (Yu-Gi-Oh!) ──────────────────────────────────────────
async function searchYGOProDeck(cardName: string): Promise<Match[]> {
  try {
    let resp = await fetch(
      `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(cardName)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!resp.ok) {
      resp = await fetch(
        `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(cardName)}`,
        { headers: { Accept: "application/json" } }
      );
    }
    if (!resp.ok) return [];
    const cards = (await resp.json())?.data || [];
    const matches: Match[] = [];
    for (const card of cards.slice(0, 3)) {
      const sets = card.card_sets || [];
      const tcgPrice = parseFloat(card.card_prices?.[0]?.tcgplayer_price) || null;
      if (sets.length === 0) {
        matches.push({
          card_name: card.name,
          card_set: null,
          card_number: null,
          rarity: null,
          market_price: tcgPrice,
          product_id: null,
          tcgplayer_url: tcgPrice
            ? `https://www.tcgplayer.com/search/yugioh/product?q=${encodeURIComponent(card.name)}`
            : null,
          image_url: card.card_images?.[0]?.image_url || null,
          game: "yugioh",
        });
      } else {
        for (const s of sets.slice(0, 5)) {
          matches.push({
            card_name: card.name,
            card_set: s.set_name || null,
            card_number: s.set_code || null,
            rarity: s.set_rarity || null,
            market_price: parseFloat(s.set_price) || tcgPrice,
            product_id: null,
            tcgplayer_url: `https://www.tcgplayer.com/search/yugioh/product?q=${encodeURIComponent(card.name)}`,
            image_url: card.card_images?.[0]?.image_url || null,
            game: "yugioh",
          });
        }
      }
    }
    return matches.slice(0, 10);
  } catch (err) {
    console.warn("[YGOProDeck] error:", err);
    return [];
  }
}

// ── Pokémon TCG ─────────────────────────────────────────────────────
async function searchPokemonTCG(cardName: string): Promise<Match[]> {
  try {
    const resp = await fetch(
      `https://api.pokemontcg.io/v2/cards?q=name:"${encodeURIComponent(cardName)}"&pageSize=10`,
      { headers: { Accept: "application/json" } }
    );
    if (!resp.ok) return [];
    const cards = (await resp.json())?.data || [];
    return cards.slice(0, 10).map((c: any) => ({
      card_name: c.name,
      card_set: c.set?.name || null,
      card_number: c.number || null,
      rarity: c.rarity || null,
      market_price:
        c.tcgplayer?.prices?.holofoil?.market ||
        c.tcgplayer?.prices?.normal?.market ||
        c.tcgplayer?.prices?.reverseHolofoil?.market ||
        null,
      product_id: null,
      tcgplayer_url: c.tcgplayer?.url || null,
      image_url: c.images?.large || c.images?.small || null,
      game: "pokemon",
    }));
  } catch (err) {
    console.warn("[PokemonTCG] error:", err);
    return [];
  }
}
