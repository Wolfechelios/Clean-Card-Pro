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

// Use Perplexity to search for PSA 10 price
async function fetchPSA10WithPerplexity(card: any): Promise<{
  price: number | null;
  confidence: number;
  source_ref: string;
  raw: any;
}> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY) {
    console.log('PERPLEXITY_API_KEY not configured');
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }

  try {
    const playerName = card.player_name || card.card_name;
    const cardSet = card.card_set || card.set_name;
    const year = card.year || card.raw_year;
    const cardNumber = card.card_number;

    const searchQuery = [playerName, cardSet, year, cardNumber, "PSA 10 price"].filter(Boolean).join(" ");
    console.log("Perplexity PSA 10 search:", searchQuery);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
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
    });

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
    console.error('Perplexity PSA 10 error:', error);
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }
}

// Estimate PSA 10 price based on raw price (fallback)
function estimatePSA10FromRaw(rawPrice: number | null): number | null {
  if (!rawPrice || rawPrice <= 0) return null;
  // PSA 10 typically 2-4x raw price for modern cards
  // Use 2.5x as a conservative estimate
  return Math.round(rawPrice * 2.5 * 100) / 100;
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

    // Try Perplexity web search
    let result = await fetchPSA10WithPerplexity(card);
    let source = "perplexity";

    // Fallback: estimate from raw price if available
    if (!result.price && card.current_price_raw) {
      const estimatedPrice = estimatePSA10FromRaw(card.current_price_raw);
      if (estimatedPrice) {
        result = {
          price: estimatedPrice,
          confidence: 50,
          source_ref: "estimated",
          raw: { method: "2.5x raw price multiplier", raw_price: card.current_price_raw }
        };
        source = "estimated";
      }
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
