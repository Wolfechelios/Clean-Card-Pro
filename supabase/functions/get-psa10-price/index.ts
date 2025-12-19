import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Normalize text for identity hash
function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// Normalize card number
function normalizeCardNumber(num: string | null | undefined): string {
  if (!num) return "";
  // Remove leading zeros, slashes, hashes
  return num
    .replace(/^[#0]+/, "")
    .replace(/\/.*$/, "")
    .trim();
}

// Normalize set name
function normalizeSetName(set: string | null | undefined): string {
  if (!set) return "";
  return set
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(series|set|edition|collection)\b/g, "")
    .trim();
}

// Generate identity hash for card
function generateIdentityHash(card: any): string {
  const game = normalizeText(card.game_type || card.sport_type || "unknown");
  const name = normalizeText(card.card_name || card.player_name);
  const set = normalizeSetName(card.card_set || card.set_name);
  const year = card.year?.toString() || "";
  const number = normalizeCardNumber(card.card_number);
  const manufacturer = normalizeText(card.manufacturer);
  const variant = normalizeText(card.variant || card.edition);
  
  const identity = `${game}|${name}|${set}|${year}|${number}|${manufacturer}|${variant}`;
  return btoa(identity).replace(/[=+/]/g, "");
}

// Fetch PSA10 price from SportsCardPro
async function fetchFromSportsCardPro(card: any): Promise<{
  price: number | null;
  confidence: number;
  source_ref: string;
  raw: any;
}> {
  try {
    // Build search query - focus on player/card name and year for best results
    const playerName = card.player_name || card.card_name;
    const cardSet = card.card_set || card.set_name;
    const year = card.year || card.raw_year;
    const cardNumber = card.card_number || card.raw_number;
    
    // First search for the card
    const searchQuery = [playerName, cardSet, year, cardNumber].filter(Boolean).join(" ");
    const searchUrl = `https://www.sportscardspro.com/search?q=${encodeURIComponent(searchQuery)}`;
    
    console.log("SportsCardPro search URL:", searchUrl);
    
    const response = await fetch(searchUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });
    
    if (!response.ok) {
      console.error("SportsCardPro fetch failed:", response.status);
      return { price: null, confidence: 0, source_ref: "", raw: null };
    }
    
    const html = await response.text();
    
    // Look for PSA 10 price patterns in the HTML
    // SportsCardPro shows prices in format like "PSA 10: $XXX.XX" or in price tables
    const psa10Patterns = [
      /PSA\s*10[^$]*\$\s*([\d,]+(?:\.\d{2})?)/gi,
      /grade[:\s]*10[^$]*\$\s*([\d,]+(?:\.\d{2})?)/gi,
      /gem\s*mint[^$]*\$\s*([\d,]+(?:\.\d{2})?)/gi,
      /<td[^>]*>PSA\s*10<\/td>\s*<td[^>]*>\$?([\d,]+(?:\.\d{2})?)/gi,
      /data-grade="10"[^>]*>[^<]*\$\s*([\d,]+(?:\.\d{2})?)/gi
    ];
    
    let bestPrice: number | null = null;
    let priceText = "";
    
    for (const pattern of psa10Patterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        const price = parseFloat(match[1].replace(/,/g, ""));
        if (price > 0 && (!bestPrice || price > bestPrice)) {
          bestPrice = price;
          priceText = match[0];
        }
      }
    }
    
    // If no PSA 10 specific price, look for any graded price
    if (!bestPrice) {
      const gradedMatch = html.match(/graded[^$]*\$\s*([\d,]+(?:\.\d{2})?)/i);
      if (gradedMatch) {
        bestPrice = parseFloat(gradedMatch[1].replace(/,/g, ""));
        priceText = gradedMatch[0];
      }
    }
    
    if (bestPrice && bestPrice > 0) {
      return {
        price: bestPrice,
        confidence: priceText.toLowerCase().includes("psa") && priceText.includes("10") ? 90 : 70,
        source_ref: searchUrl,
        raw: { query: searchQuery, priceText, url: searchUrl }
      };
    }
    
    console.log("No PSA 10 price found on SportsCardPro for:", searchQuery);
    return { price: null, confidence: 0, source_ref: "", raw: null };
  } catch (error) {
    console.error("SportsCardPro error:", error);
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }
}

// Fetch PSA10 price from PriceCharting
async function fetchFromPriceCharting(card: any): Promise<{
  price: number | null;
  confidence: number;
  source_ref: string;
  raw: any;
}> {
  try {
    const gameType = card.game_type?.toLowerCase() || "";
    let pcCategory = "trading-cards";
    if (gameType.includes("pokemon")) pcCategory = "pokemon";
    else if (gameType.includes("yugioh") || gameType.includes("yu-gi-oh")) pcCategory = "yugioh";
    else if (gameType.includes("magic") || gameType.includes("mtg")) pcCategory = "magic-the-gathering";
    
    const searchQuery = [
      card.card_name,
      card.card_set,
      card.card_number
    ].filter(Boolean).join(" ");
    
    const url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(searchQuery)}&type=prices&console=${pcCategory}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "CardScanner/1.0" }
    });
    
    if (!response.ok) {
      console.error("PriceCharting fetch failed:", response.status);
      return { price: null, confidence: 0, source_ref: "", raw: null };
    }
    
    const html = await response.text();
    
    // Look for graded/PSA 10 prices
    const gradedMatch = html.match(/graded[^$]*\$[\d,]+(?:\.\d{2})?/i);
    const psa10Match = html.match(/psa\s*10[^$]*\$[\d,]+(?:\.\d{2})?/i);
    
    const matchText = psa10Match?.[0] || gradedMatch?.[0];
    if (matchText) {
      const priceMatch = matchText.match(/\$[\d,]+(?:\.\d{2})?/);
      if (priceMatch) {
        const price = parseFloat(priceMatch[0].replace(/[$,]/g, ""));
        return {
          price,
          confidence: psa10Match ? 85 : 70,
          source_ref: url,
          raw: { query: searchQuery, priceText: matchText }
        };
      }
    }
    
    return { price: null, confidence: 0, source_ref: "", raw: null };
  } catch (error) {
    console.error("PriceCharting error:", error);
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { card_id } = await req.json();
    
    if (!card_id) {
      return new Response(
        JSON.stringify({ error: "card_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the card
    const { data: card, error: cardError } = await supabase
      .from("cards")
      .select("*")
      .eq("id", card_id)
      .single();

    if (cardError || !card) {
      return new Response(
        JSON.stringify({ error: "Card not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if locked and recently updated
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    if (card.psa10_locked && card.psa10_price && card.psa10_updated_at) {
      const lastUpdate = new Date(card.psa10_updated_at);
      if (lastUpdate > thirtyDaysAgo) {
        return new Response(
          JSON.stringify({
            psa10_price: card.psa10_price,
            psa10_currency: card.psa10_currency || "USD",
            psa10_source: card.psa10_source,
            psa10_updated_at: card.psa10_updated_at,
            confidence: card.psa10_match_confidence,
            source_ref: card.psa10_source_ref,
            cached: true
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Generate identity hash
    const identityHash = generateIdentityHash(card);
    
    // Check cache
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    
    const { data: cached } = await supabase
      .from("price_cache")
      .select("*")
      .eq("identity_hash", identityHash)
      .gte("updated_at", twentyFourHoursAgo.toISOString())
      .single();

    if (cached && cached.price) {
      // Update card with cached price
      await supabase
        .from("cards")
        .update({
          psa10_price: cached.price,
          psa10_currency: cached.currency,
          psa10_source: cached.source,
          psa10_updated_at: new Date().toISOString(),
          psa10_match_confidence: cached.confidence,
          psa10_source_ref: cached.source_ref
        })
        .eq("id", card_id);

      return new Response(
        JSON.stringify({
          psa10_price: cached.price,
          psa10_currency: cached.currency || "USD",
          psa10_source: cached.source,
          psa10_updated_at: new Date().toISOString(),
          confidence: cached.confidence,
          source_ref: cached.source_ref,
          cached: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine which provider to use based on card type
    const isSportsCard = card.sport_type || card.sport;
    let result: { price: number | null; confidence: number; source_ref: string; raw: any };
    let source: string;

    if (isSportsCard) {
      result = await fetchFromSportsCardPro(card);
      source = "sportscardspro";
      
      // Fallback to PriceCharting if no result
      if (!result.price) {
        result = await fetchFromPriceCharting(card);
        source = "pricecharting";
      }
    } else {
      result = await fetchFromPriceCharting(card);
      source = "pricecharting";
      
      // Fallback to SportsCardPro if no result
      if (!result.price) {
        result = await fetchFromSportsCardPro(card);
        source = "sportscardspro";
      }
    }

    // Check confidence threshold before overwriting
    const shouldUpdate = result.price && (
      !card.psa10_price || 
      result.confidence >= 85 ||
      card.psa10_match_confidence === null ||
      card.psa10_match_confidence < result.confidence
    );

    if (result.price) {
      // Upsert to cache
      await supabase
        .from("price_cache")
        .upsert({
          identity_hash: identityHash,
          source,
          price: result.price,
          currency: "USD",
          confidence: result.confidence,
          source_ref: result.source_ref,
          raw: result.raw,
          updated_at: new Date().toISOString()
        }, { onConflict: "identity_hash" });
    }

    if (shouldUpdate) {
      // Update card
      await supabase
        .from("cards")
        .update({
          psa10_price: result.price,
          psa10_currency: "USD",
          psa10_source: source,
          psa10_updated_at: new Date().toISOString(),
          psa10_match_confidence: result.confidence,
          psa10_source_ref: result.source_ref
        })
        .eq("id", card_id);
    }

    return new Response(
      JSON.stringify({
        psa10_price: result.price,
        psa10_currency: "USD",
        psa10_source: source,
        psa10_updated_at: new Date().toISOString(),
        confidence: result.confidence,
        source_ref: result.source_ref,
        cached: false
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("get-psa10-price error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
