import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REQUEST_TIMEOUT_MS = 12000;

function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  return text.toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}

function generateIdentityHash(card: any): string {
  const game = normalizeText(card.game_type || card.sport_type || "unknown");
  const name = normalizeText(card.card_name || card.player_name);
  const set = normalizeText(card.card_set || card.set_name);
  const year = card.year?.toString() || "";
  const number = card.card_number?.replace(/^[#0]+/, "").trim() || "";
  const identity = `${game}|${name}|${set}|${year}|${number}`;
  return btoa(identity).replace(/[=+/]/g, "");
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Scrape PSA 10 price directly from a PriceCharting.com card page using Firecrawl
async function scrapePSA10FromPriceCharting(cardUrl: string): Promise<{
  price: number | null;
  confidence: number;
  source_ref: string;
  raw: any;
}> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  if (!FIRECRAWL_API_KEY) {
    console.log('FIRECRAWL_API_KEY not configured, cannot scrape PriceCharting');
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }

  try {
    // Ensure full URL
    let url = cardUrl.trim();
    if (!url.startsWith('http')) {
      url = `https://www.pricecharting.com${url.startsWith('/') ? '' : '/'}${url}`;
    }

    console.log('Scraping PriceCharting page:', url);

    const response = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    }, REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      console.error('Firecrawl scrape error:', response.status);
      return { price: null, confidence: 0, source_ref: "", raw: null };
    }

    const data = await response.json();
    const markdown = data?.data?.markdown || data?.markdown || "";

    console.log('PriceCharting markdown length:', markdown.length);

    // Extract PSA 10 price from the page content
    // PriceCharting typically shows prices in a table/grid format
    // Look for patterns like "PSA 10" followed by a price
    const psa10Price = extractPSA10Price(markdown);

    if (psa10Price !== null) {
      console.log(`PriceCharting PSA 10 price found: $${psa10Price}`);
      return {
        price: psa10Price,
        confidence: 95,
        source_ref: url,
        raw: { method: "pricecharting-scrape", url, price_found: psa10Price }
      };
    }

    console.log('No PSA 10 price found on page');
    return { price: null, confidence: 0, source_ref: url, raw: { method: "pricecharting-scrape", url, price_found: null } };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('PriceCharting scrape timed out');
    } else {
      console.error('PriceCharting scrape error:', error);
    }
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }
}

// Extract the exact PSA 10 price from PriceCharting page markdown
function extractPSA10Price(markdown: string): number | null {
  if (!markdown) return null;

  // Normalize line breaks
  const text = markdown.replace(/\r\n/g, '\n');

  // Strategy 1: Look for "PSA 10" in table rows or near price values
  // Common patterns on PriceCharting:
  //   "PSA 10 | $2,850.00" or "PSA 10: $2,850.00" or "PSA 10 $2,850.00"
  //   Also "Gem Mint 10" or "GEM-MT 10"
  const psa10Patterns = [
    /PSA\s*10[^$\d]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /GEM[\s-]*(?:MT|MINT)\s*10[^$\d]*\$?([\d,]+(?:\.\d{1,2})?)/i,
    /\$?([\d,]+(?:\.\d{1,2})?)\s*\|?\s*PSA\s*10/i,
    /Grade:\s*PSA\s*10[^$\d]*\$?([\d,]+(?:\.\d{1,2})?)/i,
  ];

  for (const pattern of psa10Patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const priceStr = match[1].replace(/,/g, '');
      const price = parseFloat(priceStr);
      if (price > 0 && price < 10000000) {
        return price;
      }
    }
  }

  // Strategy 2: Look for a line/section containing "PSA 10" and extract the nearest price
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/PSA\s*10|GEM[\s-]*(?:MT|MINT)\s*10/i.test(line)) {
      // Check this line and adjacent lines for a price
      const searchBlock = [lines[i - 1] || "", line, lines[i + 1] || ""].join(" ");
      const priceMatch = searchBlock.match(/\$?([\d,]+(?:\.\d{1,2})?)/);
      if (priceMatch && priceMatch[1]) {
        const priceStr = priceMatch[1].replace(/,/g, '');
        const price = parseFloat(priceStr);
        if (price > 0.5 && price < 10000000) {
          return price;
        }
      }
    }
  }

  // Strategy 3: Look in markdown table format "| PSA 10 | $1,234.56 |"
  const tablePattern = /\|\s*PSA\s*10\s*\|\s*\$?([\d,]+(?:\.\d{1,2})?)\s*\|/i;
  const tableMatch = text.match(tablePattern);
  if (tableMatch && tableMatch[1]) {
    const priceStr = tableMatch[1].replace(/,/g, '');
    const price = parseFloat(priceStr);
    if (price > 0 && price < 10000000) {
      return price;
    }
  }

  return null;
}

// Find the PriceCharting URL for a Yu-Gi-Oh! card from local data
async function findPriceChartingUrl(supabase: any, card: any): Promise<string | null> {
  const cardNameClean = (card.card_name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();

  if (!cardNameClean || cardNameClean.length < 2) return null;

  // Try exact card number + name match first
  if (card.card_number) {
    const cleanNum = card.card_number.replace(/^[#0]+/, "").trim();
    const { data: exact } = await supabase
      .from("pc_cards")
      .select("card_url, card_name, card_number")
      .eq("user_id", card.user_id)
      .eq("card_number", cleanNum)
      .ilike("card_name_clean", `%${cardNameClean}%`)
      .not("card_url", "is", null)
      .limit(1);

    if (exact?.length && exact[0].card_url) {
      console.log(`[YGO] URL match by number+name: ${exact[0].card_name}`);
      return exact[0].card_url;
    }
  }

  // Fallback: fuzzy name match
  if (cardNameClean.length >= 3) {
    const { data: fuzzy } = await supabase
      .from("pc_cards")
      .select("card_url, card_name")
      .eq("user_id", card.user_id)
      .ilike("card_name_clean", `%${cardNameClean}%`)
      .not("card_url", "is", null)
      .limit(3);

    if (fuzzy?.length && fuzzy[0].card_url) {
      console.log(`[YGO] URL match by name: ${fuzzy[0].card_name}`);
      return fuzzy[0].card_url;
    }
  }

  return null;
}

// Perplexity fallback for non-YGO cards
async function fetchPSA10WithPerplexity(card: any): Promise<{
  price: number | null;
  confidence: number;
  source_ref: string;
  raw: any;
}> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY) {
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }

  try {
    const playerName = card.player_name || card.card_name;
    const cardSet = card.card_set || card.set_name;
    const year = card.year || card.raw_year;
    const cardNumber = card.card_number;
    const searchQuery = [playerName, cardSet, year, cardNumber, "PSA 10 price"].filter(Boolean).join(" ");

    const response = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: `You are a trading card price finder. Find the PSA 10 graded price for cards.\nReturn ONLY a number representing the USD price (no $ symbol, no text).\nIf you find a price range, return the average.\nIf you cannot find a reliable PSA 10 price, respond with: 0` },
          { role: 'user', content: `What is the current PSA 10 price for: ${playerName}${cardSet ? ` from ${cardSet}` : ''}${year ? ` (${year})` : ''}${cardNumber ? ` #${cardNumber}` : ''}?` }
        ],
        search_domain_filter: ['sportscardpro.com', 'pricecharting.com', 'psacard.com', '130point.com', 'ebay.com'],
      }),
    }, REQUEST_TIMEOUT_MS);

    if (!response.ok) return { price: null, confidence: 0, source_ref: "", raw: null };

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    const citations = data.citations || [];

    if (content) {
      const priceStr = content.replace(/[^0-9.]/g, '');
      const price = parseFloat(priceStr);
      if (price && price > 0 && price < 1000000) {
        return { price, confidence: citations.length > 0 ? 85 : 70, source_ref: citations[0] || 'perplexity', raw: { query: searchQuery, response: content, citations } };
      }
    }
    return { price: null, confidence: 0, source_ref: "", raw: null };
  } catch (error) {
    console.error('Perplexity PSA 10 error:', error);
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { card_id, skip_api } = await req.json();

    if (!card_id) {
      return new Response(JSON.stringify({ error: "card_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: card, error: cardError } = await supabase
      .from("cards").select("*").eq("id", card_id).single();

    if (cardError || !card) {
      return new Response(JSON.stringify({ error: "Card not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Return locked price
    if (card.psa10_locked && card.psa10_price) {
      return new Response(JSON.stringify({
        psa10_price: card.psa10_price, psa10_currency: card.psa10_currency || "USD",
        psa10_source: card.psa10_source, psa10_updated_at: card.psa10_updated_at,
        confidence: card.psa10_match_confidence, cached: true
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check 24h cache
    const identityHash = generateIdentityHash(card);
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const { data: cached } = await supabase
      .from("price_cache").select("*")
      .eq("identity_hash", identityHash)
      .gte("updated_at", twentyFourHoursAgo.toISOString())
      .single();

    if (cached && cached.price) {
      await supabase.from("cards").update({
        psa10_price: cached.price, psa10_currency: cached.currency,
        psa10_source: cached.source, psa10_updated_at: new Date().toISOString(),
        psa10_match_confidence: cached.confidence, psa10_source_ref: cached.source_ref
      }).eq("id", card_id);

      return new Response(JSON.stringify({
        psa10_price: cached.price, psa10_currency: cached.currency || "USD",
        psa10_source: cached.source, confidence: cached.confidence, cached: true
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let result = { price: null as number | null, confidence: 0, source_ref: "", raw: null as any };
    let source = "none";

    const gameType = (card.game_type || "").toLowerCase();
    const isYugioh = gameType.includes("yugioh") || gameType.includes("yu-gi-oh") || gameType === "yu gi oh";

    // === YU-GI-OH: Scrape exact PSA 10 price from PriceCharting.com ===
    if (isYugioh && !skip_api) {
      const pcUrl = await findPriceChartingUrl(supabase, card);
      if (pcUrl) {
        result = await scrapePSA10FromPriceCharting(pcUrl);
        if (result.price) {
          source = "pricecharting";
        }
      } else {
        console.log('[YGO] No PriceCharting URL found for card:', card.card_name);
      }
    }

    // Non-YGO: use Perplexity
    if (!result.price && !skip_api && !isYugioh) {
      result = await fetchPSA10WithPerplexity(card);
      if (result.price) source = "perplexity";
    }

    // Fallback: use existing psa10 price from import
    if (!result.price && card.current_price_psa10) {
      result = { price: card.current_price_psa10, confidence: 60, source_ref: "imported", raw: { method: "existing psa10 price" } };
      source = "imported";
    }

    // NO estimation or multiplier fallback for YGO — strict rule: exact price or null

    // For non-YGO, allow estimation fallback from raw price
    if (!result.price && !isYugioh && card.current_price_raw) {
      const r = (card.rarity || "").toLowerCase();
      let mult = 2.5;
      if (r.includes('ultra') || r.includes('secret') || r.includes('starlight')) mult = 3.0;
      else if (r.includes('super') || r.includes('holo')) mult = 2.8;
      else if (r.includes('common')) mult = 2.0;
      const est = Math.round(card.current_price_raw * mult * 100) / 100;
      result = { price: est, confidence: 50, source_ref: "estimated", raw: { method: "multiplier", raw_price: card.current_price_raw } };
      source = "estimated";
    }

    if (result.price) {
      await supabase.from("price_cache").upsert({
        identity_hash: identityHash, source, price: result.price, currency: "USD",
        confidence: result.confidence, source_ref: result.source_ref, raw: result.raw,
        updated_at: new Date().toISOString()
      }, { onConflict: "identity_hash" });

      await supabase.from("cards").update({
        psa10_price: result.price, psa10_currency: "USD", psa10_source: source,
        psa10_updated_at: new Date().toISOString(), psa10_match_confidence: result.confidence,
        psa10_source_ref: result.source_ref
      }).eq("id", card_id);
    }

    return new Response(JSON.stringify({
      psa10_price: result.price, psa10_currency: "USD", psa10_source: source,
      confidence: result.confidence, cached: false
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("get-psa10-price error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
