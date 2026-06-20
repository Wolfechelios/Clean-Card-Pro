import { corsHeaders } from "../_shared/cors.ts";

interface SportsCardPriceResult {
  sportsCardPro: SourceResult;
  cardLadder: SourceResult;
  oneThirtyPoint: SourceResult;
  ebay: SourceResult;
}

interface SourceResult {
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  url: string | null;
  source: string;
}

const FIRECRAWL_API = "https://api.firecrawl.dev/v1";

function emptyResult(source: string): SourceResult {
  return { raw: null, psa9: null, psa10: null, url: null, source };
}

function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/\$?([\d]+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

async function scrapeWithFirecrawl(url: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch(`${FIRECRAWL_API}/scrape`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
      }),
    });

    if (!response.ok) {
      console.error(`Firecrawl scrape failed for ${url}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.data?.markdown || data?.markdown || null;
  } catch (e) {
    console.error(`Firecrawl error for ${url}:`, e);
    return null;
  }
}

async function fetchSportsCardPro(
  query: string,
  apiKey: string
): Promise<SourceResult> {
  const result = emptyResult("SportsCardPro");
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.sportscardspro.com/search?query=${encoded}`;
    result.url = url;

    const markdown = await scrapeWithFirecrawl(url, apiKey);
    if (!markdown) return result;

    // Extract prices from markdown content
    // Look for price patterns like "$XX.XX" near keywords
    const lines = markdown.split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("ungraded") || lower.includes("raw")) {
        const price = parsePrice(line);
        if (price && !result.raw) result.raw = price;
      }
      if (lower.includes("psa 9") || lower.includes("grade 9")) {
        const price = parsePrice(line);
        if (price && !result.psa9) result.psa9 = price;
      }
      if (lower.includes("psa 10") || lower.includes("gem mint") || lower.includes("grade 10")) {
        const price = parsePrice(line);
        if (price && !result.psa10) result.psa10 = price;
      }
    }

    // If no categorized prices found, try to find any price as raw
    if (!result.raw) {
      for (const line of lines) {
        const price = parsePrice(line);
        if (price && price > 0.1 && price < 100000) {
          result.raw = price;
          break;
        }
      }
    }

    console.log("SportsCardPro result:", result);
    return result;
  } catch (e) {
    console.error("SportsCardPro error:", e);
    return result;
  }
}

async function fetchCardLadder(
  query: string,
  apiKey: string
): Promise<SourceResult> {
  const result = emptyResult("CardLadder");
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.cardladder.com/search?q=${encoded}`;
    result.url = url;

    const markdown = await scrapeWithFirecrawl(url, apiKey);
    if (!markdown) return result;

    const lines = markdown.split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      // CardLadder shows market values, PSA grades
      if (lower.includes("raw") || lower.includes("ungraded") || lower.includes("market value")) {
        const price = parsePrice(line);
        if (price && !result.raw) result.raw = price;
      }
      if (lower.includes("psa 9")) {
        const price = parsePrice(line);
        if (price && !result.psa9) result.psa9 = price;
      }
      if (lower.includes("psa 10") || lower.includes("gem")) {
        const price = parsePrice(line);
        if (price && !result.psa10) result.psa10 = price;
      }
    }

    if (!result.raw) {
      for (const line of lines) {
        const price = parsePrice(line);
        if (price && price > 0.1 && price < 100000) {
          result.raw = price;
          break;
        }
      }
    }

    console.log("CardLadder result:", result);
    return result;
  } catch (e) {
    console.error("CardLadder error:", e);
    return result;
  }
}

async function fetch130Point(
  query: string,
  apiKey: string
): Promise<SourceResult> {
  const result = emptyResult("130point");
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://130point.com/sales/?search=${encoded}`;
    result.url = url;

    const markdown = await scrapeWithFirecrawl(url, apiKey);
    if (!markdown) return result;

    // 130point shows eBay sold listings aggregated
    const prices: number[] = [];
    const lines = markdown.split("\n");
    
    for (const line of lines) {
      const priceMatches = line.match(/\$[\d,]+\.?\d*/g);
      if (priceMatches) {
        for (const pm of priceMatches) {
          const val = parsePrice(pm);
          if (val && val > 0.1 && val < 100000) {
            prices.push(val);
          }
        }
      }
    }

    if (prices.length > 0) {
      // Use median of all found prices
      prices.sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      result.raw = prices.length % 2 !== 0
        ? prices[mid]
        : parseFloat(((prices[mid - 1] + prices[mid]) / 2).toFixed(2));
      result.url = url;
    }

    // Look for graded prices
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("psa 9")) {
        const price = parsePrice(line);
        if (price && !result.psa9) result.psa9 = price;
      }
      if (lower.includes("psa 10")) {
        const price = parsePrice(line);
        if (price && !result.psa10) result.psa10 = price;
      }
    }

    console.log("130point result:", result);
    return result;
  } catch (e) {
    console.error("130point error:", e);
    return result;
  }
}

async function fetchEbaySold(
  query: string,
  apiKey: string
): Promise<SourceResult> {
  const result = emptyResult("eBay-Sold");
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1&_sop=13`;
    result.url = url;

    const markdown = await scrapeWithFirecrawl(url, apiKey);
    if (!markdown) return result;

    const prices: number[] = [];
    const lines = markdown.split("\n");

    for (const line of lines) {
      const priceMatches = line.match(/\$[\d,]+\.?\d*/g);
      if (priceMatches) {
        for (const pm of priceMatches) {
          const val = parsePrice(pm);
          if (val && val > 0.5 && val < 100000) {
            prices.push(val);
          }
        }
      }
    }

    if (prices.length > 0) {
      prices.sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      result.raw = prices.length % 2 !== 0
        ? prices[mid]
        : parseFloat(((prices[mid - 1] + prices[mid]) / 2).toFixed(2));
    }

    console.log("eBay Sold result:", result);
    return result;
  } catch (e) {
    console.error("eBay Sold error:", e);
    return result;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cardName, cardSet, cardNumber, playerName, year, sportType } = await req.json();

    if (!cardName) {
      return new Response(
        JSON.stringify({ error: "cardName is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Firecrawl connector not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build search query from available card info
    const queryParts = [cardName];
    if (playerName && !cardName.toLowerCase().includes(playerName.toLowerCase())) {
      queryParts.push(playerName);
    }
    if (cardSet) queryParts.push(cardSet);
    if (year) queryParts.push(String(year));
    if (cardNumber) queryParts.push(`#${cardNumber}`);
    const searchQuery = queryParts.join(" ").trim();

    console.log("Sports card price search:", searchQuery);

    // Fetch all sources in parallel
    const [sportsCardPro, cardLadder, oneThirtyPoint, ebay] = await Promise.all([
      fetchSportsCardPro(searchQuery, apiKey),
      fetchCardLadder(searchQuery, apiKey),
      fetch130Point(searchQuery, apiKey),
      fetchEbaySold(searchQuery, apiKey),
    ]);

    const result: SportsCardPriceResult = {
      sportsCardPro,
      cardLadder,
      oneThirtyPoint,
      ebay,
    };

    console.log("Sports card pricing complete:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Sports card pricing error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
