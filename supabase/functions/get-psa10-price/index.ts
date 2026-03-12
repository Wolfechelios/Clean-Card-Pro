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

// Extract exact PSA 10 price from PriceCharting page markdown table
function extractPSA10Price(markdown: string): number | null {
  if (!markdown) return null;
  const text = markdown.replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  // PRIMARY: Parse the PriceCharting markdown pricing table
  // Format: | Ungraded | Grade 7 | Grade 8 | Grade 9 | Grade 9.5 | PSA 10 |
  //         | $0.15... | -       | -       | $10.23  | $11.00    | $30.64... |
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Find the header row containing grade columns
    if (/\|\s*PSA\s*10\s*\|/i.test(line) && /\|\s*(?:Ungraded|Grade)\s/i.test(line)) {
      // This is the header row - find PSA 10 column index
      const headers = line.split('|').map(h => h.trim()).filter(h => h.length > 0);
      const psa10Index = headers.findIndex(h => /^PSA\s*10$/i.test(h));
      if (psa10Index === -1) continue;

      // Look at the next non-separator row for prices
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const dataLine = lines[j];
        if (/^\s*\|[\s-]+\|/.test(dataLine) && !/\$/.test(dataLine)) continue; // skip separator
        if (!/\|/.test(dataLine)) continue;
        
        const cells = dataLine.split('|').map(c => c.trim()).filter(c => c.length > 0);
        if (psa10Index < cells.length) {
          const cell = cells[psa10Index];
          // Extract first dollar amount from the cell (e.g., "$30.64<br> <br> +$0.25")
          const priceMatch = cell.match(/\$?([\d,]+(?:\.\d{1,2})?)/);
          if (priceMatch?.[1]) {
            const price = parseFloat(priceMatch[1].replace(/,/g, ''));
            if (price > 0 && price < 10000000) {
              console.log(`Table extraction: PSA 10 = $${price} (column ${psa10Index})`);
              return price;
            }
          }
        }
        break;
      }
    }
  }

  // SECONDARY: Look for a simpler repeated table like:
  // | Grade 9 | Grade 9.5 | PSA 10 |  |
  // | $10.23  | $11.00    | $30.64 |  |
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\|\s*PSA\s*10\s*\|/i.test(line) && !/Ungraded/i.test(line) && !/Sold/i.test(line)) {
      const headers = line.split('|').map(h => h.trim()).filter(h => h.length > 0);
      const psa10Index = headers.findIndex(h => /^PSA\s*10$/i.test(h));
      if (psa10Index === -1) continue;

      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const dataLine = lines[j];
        if (/^\s*\|[\s-]+\|/.test(dataLine) && !/\$/.test(dataLine)) continue;
        if (!/\|/.test(dataLine)) continue;

        const cells = dataLine.split('|').map(c => c.trim()).filter(c => c.length > 0);
        if (psa10Index < cells.length) {
          const cell = cells[psa10Index];
          const priceMatch = cell.match(/\$?([\d,]+(?:\.\d{1,2})?)/);
          if (priceMatch?.[1]) {
            const price = parseFloat(priceMatch[1].replace(/,/g, ''));
            if (price > 0 && price < 10000000) {
              console.log(`Secondary table extraction: PSA 10 = $${price}`);
              return price;
            }
          }
        }
        break;
      }
    }
  }

  // TERTIARY: Check for "PSA 10" in a non-chart context with a dollar sign price nearby
  // Avoid Highcharts text which contains dates like "PSA 10Oct 2024"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip chart/graph lines
    if (/Highcharts|Zoom|View \d|month|year/i.test(line)) continue;
    
    // Match "PSA 10" followed by a dollar price (require $ sign to avoid year matches)
    const match = line.match(/PSA\s*10[^$\d]{0,20}\$([\d,]+(?:\.\d{1,2})?)/i);
    if (match?.[1]) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price > 0 && price < 10000000) {
        console.log(`Line extraction: PSA 10 = $${price}`);
        return price;
      }
    }
  }

  // Check if PriceCharting says the PSA 10 price is an estimate with no real sales
  if (/No sales data for this card and grade/i.test(text) && /estimate/i.test(text)) {
    console.log('PriceCharting shows PSA 10 as estimate only (no real sales data)');
    // Still return the table value if we found one above; if we're here, we didn't find it
  }

  return null;
}

// Scrape PSA 10 price from a PriceCharting URL via Firecrawl
async function scrapePSA10FromUrl(url: string): Promise<{
  price: number | null;
  confidence: number;
  source_ref: string;
  raw: any;
}> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  if (!FIRECRAWL_API_KEY) {
    console.log('FIRECRAWL_API_KEY not configured');
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }

  try {
    console.log('Scraping PriceCharting:', url);
    const response = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    }, REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      console.error('Firecrawl error:', response.status);
      return { price: null, confidence: 0, source_ref: "", raw: null };
    }

    const data = await response.json();
    const markdown = data?.data?.markdown || data?.markdown || "";
    const psa10Price = extractPSA10Price(markdown);

    if (psa10Price !== null) {
      console.log(`PSA 10 scraped: $${psa10Price} from ${url}`);
      return { price: psa10Price, confidence: 95, source_ref: url, raw: { method: "pricecharting-scrape", url } };
    }

    console.log('No PSA 10 price found on page');
    return { price: null, confidence: 0, source_ref: url, raw: { method: "pricecharting-scrape", url, price_found: null } };
  } catch (error) {
    console.error('Scrape error:', error instanceof Error ? error.message : error);
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }
}

// Search PriceCharting via Firecrawl search to find the card page, then scrape it
async function searchAndScrapePriceCharting(card: any): Promise<{
  price: number | null;
  confidence: number;
  source_ref: string;
  raw: any;
}> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  if (!FIRECRAWL_API_KEY) {
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }

  try {
    const name = card.player_name || card.card_name;
    const set = card.card_set || card.set_name;
    const year = card.year || card.raw_year;
    const number = card.card_number;
    const query = `site:pricecharting.com ${name} ${set || ""} ${year || ""} ${number || ""} PSA 10`.trim();

    console.log('Firecrawl search:', query);

    const searchResp = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, limit: 3 }),
    }, REQUEST_TIMEOUT_MS);

    if (!searchResp.ok) {
      console.error('Firecrawl search error:', searchResp.status);
      return { price: null, confidence: 0, source_ref: "", raw: null };
    }

    const searchData = await searchResp.json();
    const results = searchData?.data || searchData?.results || [];

    // Find a pricecharting.com result
    for (const result of results) {
      const url = result.url || result.link || "";
      if (url.includes("pricecharting.com")) {
        // If the search result already has markdown content with PSA 10 price
        if (result.markdown) {
          const price = extractPSA10Price(result.markdown);
          if (price !== null) {
            console.log(`PSA 10 from search result: $${price}`);
            return { price, confidence: 90, source_ref: url, raw: { method: "pricecharting-search-inline", url } };
          }
        }
        // Otherwise scrape the page directly
        const scraped = await scrapePSA10FromUrl(url);
        if (scraped.price) return scraped;
      }
    }

    return { price: null, confidence: 0, source_ref: "", raw: { method: "pricecharting-search", query, results_count: results.length } };
  } catch (error) {
    console.error('Search+scrape error:', error instanceof Error ? error.message : error);
    return { price: null, confidence: 0, source_ref: "", raw: null };
  }
}

// Find PriceCharting URL from local pc_cards table
async function findLocalPriceChartingUrl(supabase: any, card: any): Promise<string | null> {
  const cardNameClean = (card.card_name || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (!cardNameClean || cardNameClean.length < 2) return null;

  if (card.card_number) {
    const cleanNum = card.card_number.replace(/^[#0]+/, "").trim();
    const { data } = await supabase
      .from("pc_cards")
      .select("card_url, card_name")
      .eq("user_id", card.user_id)
      .eq("card_number", cleanNum)
      .ilike("card_name_clean", `%${cardNameClean}%`)
      .not("card_url", "is", null)
      .limit(1);
    if (data?.length && data[0].card_url) return data[0].card_url;
  }

  if (cardNameClean.length >= 3) {
    const { data } = await supabase
      .from("pc_cards")
      .select("card_url, card_name")
      .eq("user_id", card.user_id)
      .ilike("card_name_clean", `%${cardNameClean}%`)
      .not("card_url", "is", null)
      .limit(1);
    if (data?.length && data[0].card_url) return data[0].card_url;
  }

  return null;
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

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);

    const { data: cached } = await supabase
      .from("price_cache").select("*")
      .eq("identity_hash", identityHash)
      .gte("updated_at", cutoff.toISOString())
      .single();

    if (cached?.price) {
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

    if (!skip_api) {
      // Step 1: Try local pc_cards URL → scrape PriceCharting page
      const localUrl = await findLocalPriceChartingUrl(supabase, card);
      if (localUrl) {
        const fullUrl = localUrl.startsWith('http') ? localUrl : `https://www.pricecharting.com${localUrl.startsWith('/') ? '' : '/'}${localUrl}`;
        result = await scrapePSA10FromUrl(fullUrl);
        if (result.price) source = "pricecharting";
      }

      // Step 2: No local URL — search PriceCharting via Firecrawl
      if (!result.price) {
        result = await searchAndScrapePriceCharting(card);
        if (result.price) source = "pricecharting";
      }
    }

    // Fallback: existing imported PSA 10 price
    if (!result.price && card.current_price_psa10) {
      result = { price: card.current_price_psa10, confidence: 60, source_ref: "imported", raw: { method: "existing psa10 price" } };
      source = "imported";
    }

    // No estimation, no multipliers, no guessing — exact price or null

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
