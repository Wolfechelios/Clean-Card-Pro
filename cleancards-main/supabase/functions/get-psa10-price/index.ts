import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REQUEST_TIMEOUT_MS = 8000; // 8 second timeout for API calls

// Normalize text for identity hash
function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// Generate identity hash for card
function generateIdentityHash(card: any): string {
  const game = normalizeText(card.game_type || card.sport_type || "unknown");
  const name = normalizeText(card.card_name || card.player_name);
  const set = normalizeText(card.card_set || card.set_name);
  const year = card.year?.toString() || "";
  const number = card.card_number?.replace(/^[#0]+/, "").trim() || "";
  
  const identity = `${game}|${name}|${set}|${year}|${number}`;
  return btoa(identity).replace(/[=+/]/g, "");
}

// Fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Use Perplexity to search for PSA 10 price
async function fetchPSA10WithPerplexity(card: any): Promise<{
  price: number | null;
  confidence: number;
  source_ref: string;
  raw: any;
}> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY) {
    console.log('PERPLEXITY_API_KEY not configured, using estimation');
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }

  try {
    const playerName = card.player_name || card.card_name;
    const cardSet = card.card_set || card.set_name;
    const year = card.year || card.raw_year;
    const cardNumber = card.card_number;

    const searchQuery = [playerName, cardSet, year, cardNumber, "PSA 10 price"].filter(Boolean).join(" ");
    console.log("Perplexity PSA 10 search:", searchQuery);

    const response = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { 
            role: 'system', 
            content: `You are a trading card price finder. Find the PSA 10 graded price for cards.
Return ONLY a number representing the USD price (no $ symbol, no text).
If you find a price range, return the average.
If you cannot find a reliable PSA 10 price, respond with: 0` 
          },
          { 
            role: 'user', 
            content: `What is the current PSA 10 price for: ${playerName}${cardSet ? ` from ${cardSet}` : ''}${year ? ` (${year})` : ''}${cardNumber ? ` #${cardNumber}` : ''}?`
          }
        ],
        search_domain_filter: [
          'sportscardpro.com',
          'pricecharting.com',
          'psacard.com',
          '130point.com',
          'ebay.com'
        ],
      }),
    }, REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      console.error('Perplexity API error:', response.status);
      return { price: null, confidence: 0, source_ref: "", raw: null };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    const citations = data.citations || [];
    
    console.log('Perplexity PSA 10 response:', content);

    // Extract price from response
    if (content) {
      // Remove any non-numeric characters except decimal point
      const priceStr = content.replace(/[^0-9.]/g, '');
      const price = parseFloat(priceStr);
      
      if (price && price > 0 && price < 1000000) { // Sanity check
        return {
          price,
          confidence: citations.length > 0 ? 85 : 70,
          source_ref: citations[0] || 'perplexity',
          raw: { query: searchQuery, response: content, citations }
        };
      }
    }

    return { price: null, confidence: 0, source_ref: "", raw: null };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('Perplexity request timed out, using estimation');
    } else {
      console.error('Perplexity PSA 10 error:', error);
    }
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }
}

// Estimate PSA 10 price based on raw price (fallback)
function estimatePSA10FromRaw(rawPrice: number | null, rarity?: string): number | null {
  if (!rawPrice || rawPrice <= 0) return null;
  
  // Multiplier varies by rarity
  let multiplier = 2.5;
  if (rarity) {
    const r = rarity.toLowerCase();
    if (r.includes('ultra') || r.includes('secret') || r.includes('starlight')) {
      multiplier = 3.0;
    } else if (r.includes('super') || r.includes('holo')) {
      multiplier = 2.8;
    } else if (r.includes('common')) {
      multiplier = 2.0;
    }
  }
  
  return Math.round(rawPrice * multiplier * 100) / 100;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Rate limit by user
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.sub) {
        const rl = rateLimitResponse(payload.sub, "get-psa10-price", corsHeaders, 20, 60_000);
        if (rl) return rl;
      }
    }
  } catch { /* continue */ }

  try {
    const { card_id, skip_api } = await req.json();
    
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
    if (card.psa10_locked && card.psa10_price) {
      return new Response(
        JSON.stringify({
          psa10_price: card.psa10_price,
          psa10_currency: card.psa10_currency || "USD",
          psa10_source: card.psa10_source,
          psa10_updated_at: card.psa10_updated_at,
          confidence: card.psa10_match_confidence,
          cached: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate identity hash and check cache
    const identityHash = generateIdentityHash(card);
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
          confidence: cached.confidence,
          cached: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result = { price: null as number | null, confidence: 0, source_ref: "", raw: null as any };
    let source = "estimated";

    // Only call API if not skipping (for bulk operations we might skip)
    if (!skip_api) {
      result = await fetchPSA10WithPerplexity(card);
      if (result.price) {
        source = "perplexity";
      }
    }

    // Fallback: estimate from raw price if available
    if (!result.price && card.current_price_raw) {
      const estimatedPrice = estimatePSA10FromRaw(card.current_price_raw, card.rarity);
      if (estimatedPrice) {
        result = {
          price: estimatedPrice,
          confidence: 50,
          source_ref: "estimated",
          raw: { method: "multiplier from raw price", raw_price: card.current_price_raw, rarity: card.rarity }
        };
        source = "estimated";
      }
    }

    // Fallback: use current_price_psa10 if available from import
    if (!result.price && card.current_price_psa10) {
      result = {
        price: card.current_price_psa10,
        confidence: 60,
        source_ref: "imported",
        raw: { method: "existing psa10 price" }
      };
      source = "imported";
    }

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
        confidence: result.confidence,
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
