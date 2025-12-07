import { corsHeaders } from "../_shared/cors.ts";

interface PricingResult {
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  suggested: number | null;
  ebayUrl: string | null;
  source: string;
}

interface PriceData {
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  suggested: number | null;
  ebayUrl?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cardName, cardSet, cardNumber, gameType, sportType } = await req.json();
    
    console.log("Fetching prices for:", { cardName, cardSet, cardNumber, gameType, sportType });

    const searchQuery = `${cardName} ${cardSet || ""} ${cardNumber || ""}`.trim();
    const sources: string[] = [];
    
    // Determine which sources to use based on card type
    const isTCG = gameType && ["pokemon", "yugioh", "yu-gi-oh", "mtg", "magic"].some(
      type => gameType.toLowerCase().includes(type)
    );
    const isSportsCard = sportType && ["baseball", "basketball", "football", "hockey", "soccer"].includes(
      sportType.toLowerCase()
    );

    // Fetch prices from all relevant sources in parallel
    const promises: Promise<PriceData>[] = [fetchEbayPrices(searchQuery)];
    
    if (isSportsCard) {
      promises.push(fetchSportsCardProPrices(searchQuery));
    }
    
    if (isTCG) {
      promises.push(fetchPriceChartingPrices(cardName, cardSet, gameType));
    }

    const results = await Promise.all(promises);
    
    const ebayPrices = results[0];
    sources.push("eBay");
    
    let sportsCardProPrices: PriceData = { raw: null, psa9: null, psa10: null, suggested: null };
    let priceChartingPrices: PriceData = { raw: null, psa9: null, psa10: null, suggested: null };
    
    if (isSportsCard && results[1]) {
      sportsCardProPrices = results[1];
      if (sportsCardProPrices.raw) sources.push("SportsCardPro");
    }
    
    if (isTCG) {
      const tcgIndex = isSportsCard ? 2 : 1;
      if (results[tcgIndex]) {
        priceChartingPrices = results[tcgIndex];
        if (priceChartingPrices.raw) sources.push("PriceCharting");
      }
    }

    // Merge results using median strategy when multiple sources available
    const allRawPrices = [ebayPrices.raw, sportsCardProPrices.raw, priceChartingPrices.raw].filter(p => p !== null) as number[];
    const allPsa9Prices = [ebayPrices.psa9, sportsCardProPrices.psa9, priceChartingPrices.psa9].filter(p => p !== null) as number[];
    const allPsa10Prices = [ebayPrices.psa10, sportsCardProPrices.psa10, priceChartingPrices.psa10].filter(p => p !== null) as number[];
    
    const result: PricingResult = {
      raw: getMedian(allRawPrices),
      psa9: getMedian(allPsa9Prices),
      psa10: getMedian(allPsa10Prices),
      suggested: getMedian(allRawPrices),
      ebayUrl: ebayPrices.ebayUrl ?? null,
      source: sources.join(" + ")
    };

    console.log("Pricing result:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error fetching prices:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function getMedian(prices: number[]): number | null {
  if (prices.length === 0) return null;
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
}

async function fetchEbayPrices(searchQuery: string): Promise<PriceData> {
  try {
    const encodedQuery = encodeURIComponent(searchQuery);
    const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&LH_Sold=1&LH_Complete=1&_sop=13`;
    
    console.log("Fetching eBay prices from:", ebayUrl);
    
    const response = await fetch(ebayUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      console.error("eBay fetch failed:", response.status);
      return { raw: null, psa9: null, psa10: null, suggested: null, ebayUrl };
    }

    const html = await response.text();
    const prices = extractPricesFromHtml(html);
    
    if (prices.length === 0) {
      return { raw: null, psa9: null, psa10: null, suggested: null, ebayUrl };
    }

    const median = getMedian(prices) ?? 0;
    
    return {
      raw: parseFloat(median.toFixed(2)),
      psa9: parseFloat((median * 2.5).toFixed(2)),
      psa10: parseFloat((median * 4).toFixed(2)),
      suggested: parseFloat(median.toFixed(2)),
      ebayUrl,
    };
  } catch (error) {
    console.error("Error fetching eBay prices:", error);
    return { raw: null, psa9: null, psa10: null, suggested: null, ebayUrl: null };
  }
}

async function fetchSportsCardProPrices(searchQuery: string): Promise<PriceData> {
  try {
    const encodedQuery = encodeURIComponent(searchQuery);
    const url = `https://www.sportscardspro.com/search?query=${encodedQuery}`;
    
    console.log("Fetching SportsCardPro prices from:", url);
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      console.error("SportsCardPro fetch failed:", response.status);
      return { raw: null, psa9: null, psa10: null, suggested: null };
    }

    const html = await response.text();
    const prices = extractPricesFromHtml(html);
    
    if (prices.length === 0) {
      return { raw: null, psa9: null, psa10: null, suggested: null };
    }

    const median = getMedian(prices) ?? 0;
    
    return {
      raw: parseFloat(median.toFixed(2)),
      psa9: null,
      psa10: null,
      suggested: parseFloat(median.toFixed(2)),
    };
  } catch (error) {
    console.error("Error fetching SportsCardPro prices:", error);
    return { raw: null, psa9: null, psa10: null, suggested: null };
  }
}

async function fetchPriceChartingPrices(cardName: string, cardSet: string | null, gameType: string | null): Promise<PriceData> {
  try {
    // Map game type to PriceCharting category
    let category = "pokemon";
    if (gameType) {
      const gt = gameType.toLowerCase();
      if (gt.includes("yugioh") || gt.includes("yu-gi-oh")) category = "yugioh";
      else if (gt.includes("mtg") || gt.includes("magic")) category = "magic-the-gathering";
    }

    const searchQuery = `${cardName} ${cardSet || ""}`.trim();
    const encodedQuery = encodeURIComponent(searchQuery);
    const url = `https://www.pricecharting.com/search-products?q=${encodedQuery}&type=prices&category=${category}`;
    
    console.log("Fetching PriceCharting prices from:", url);
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      console.error("PriceCharting fetch failed:", response.status);
      return { raw: null, psa9: null, psa10: null, suggested: null };
    }

    const html = await response.text();
    
    // PriceCharting has specific price columns for graded cards
    const gradedPrices = extractGradedPrices(html);
    const prices = extractPricesFromHtml(html);
    
    const median = prices.length > 0 ? getMedian(prices) ?? 0 : 0;
    
    return {
      raw: gradedPrices.ungraded ?? (median > 0 ? parseFloat(median.toFixed(2)) : null),
      psa9: gradedPrices.psa9,
      psa10: gradedPrices.psa10,
      suggested: median > 0 ? parseFloat(median.toFixed(2)) : null,
    };
  } catch (error) {
    console.error("Error fetching PriceCharting prices:", error);
    return { raw: null, psa9: null, psa10: null, suggested: null };
  }
}

function extractPricesFromHtml(html: string): number[] {
  const prices: number[] = [];
  const pricePatterns = [
    /\$([0-9,]+\.\d{2})/g,
    /data-price="([0-9.]+)"/g,
  ];

  for (const pattern of pricePatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const price = parseFloat(match[1].replace(/,/g, ""));
      if (price > 0.01 && price < 100000) {
        prices.push(price);
      }
    }
  }

  return prices;
}

function extractGradedPrices(html: string): { ungraded: number | null; psa9: number | null; psa10: number | null } {
  let ungraded: number | null = null;
  let psa9: number | null = null;
  let psa10: number | null = null;

  // Look for PriceCharting specific graded price patterns
  const ungradedMatch = html.match(/ungraded.*?\$([0-9,]+\.\d{2})/i);
  const psa9Match = html.match(/psa\s*9.*?\$([0-9,]+\.\d{2})/i);
  const psa10Match = html.match(/psa\s*10.*?\$([0-9,]+\.\d{2})/i);

  if (ungradedMatch) ungraded = parseFloat(ungradedMatch[1].replace(/,/g, ""));
  if (psa9Match) psa9 = parseFloat(psa9Match[1].replace(/,/g, ""));
  if (psa10Match) psa10 = parseFloat(psa10Match[1].replace(/,/g, ""));

  return { ungraded, psa9, psa10 };
}
