import { corsHeaders } from "../_shared/cors.ts";

interface PricingResult {
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  suggested: number | null;
  ebayUrl: string | null;
  source: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cardName, cardSet, cardNumber, gameType, sportType } = await req.json();
    
    console.log("Fetching prices for:", { cardName, cardSet, cardNumber, gameType, sportType });

    const searchQuery = `${cardName} ${cardSet || ""} ${cardNumber || ""}`.trim();
    
    // Fetch prices from both sources in parallel
    const [ebayPrices, sportsCardProPrices] = await Promise.all([
      fetchEbayPrices(searchQuery),
      fetchSportsCardProPrices(searchQuery, sportType)
    ]);

    // Merge results, preferring SportsCardPro for sports cards
    const result: PricingResult = {
      raw: sportsCardProPrices.raw ?? ebayPrices.raw ?? null,
      psa9: sportsCardProPrices.psa9 ?? ebayPrices.psa9 ?? null,
      psa10: sportsCardProPrices.psa10 ?? ebayPrices.psa10 ?? null,
      suggested: sportsCardProPrices.suggested ?? ebayPrices.suggested ?? null,
      ebayUrl: ebayPrices.ebayUrl ?? null,
      source: sportsCardProPrices.raw ? "SportsCardPro + eBay" : "eBay"
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

async function fetchEbayPrices(searchQuery: string): Promise<Partial<PricingResult>> {
  try {
    // Construct eBay sold listings search URL
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
    
    // Parse prices from HTML
    const prices = extractEbayPrices(html);
    
    return {
      ...prices,
      ebayUrl,
    };
  } catch (error) {
    console.error("Error fetching eBay prices:", error);
    return { raw: null, psa9: null, psa10: null, suggested: null, ebayUrl: null };
  }
}

function extractEbayPrices(html: string): { raw: number | null; psa9: number | null; psa10: number | null; suggested: number | null } {
  const prices: number[] = [];
  
  // Extract prices using regex patterns
  const pricePatterns = [
    /\$([0-9,]+\.\d{2})/g,
    /s-item__price">.*?\$([0-9,]+\.\d{2})/g,
  ];

  for (const pattern of pricePatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const price = parseFloat(match[1].replace(/,/g, ""));
      if (price > 0 && price < 100000) {
        prices.push(price);
      }
    }
  }

  if (prices.length === 0) {
    return { raw: null, psa9: null, psa10: null, suggested: null };
  }

  // Sort and calculate statistics
  prices.sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  // Estimate graded prices (typically 2-5x raw for high grades)
  const raw = median;
  const psa9 = median * 3;
  const psa10 = median * 4.5;
  
  return {
    raw: parseFloat(raw.toFixed(2)),
    psa9: parseFloat(psa9.toFixed(2)),
    psa10: parseFloat(psa10.toFixed(2)),
    suggested: parseFloat(avg.toFixed(2)),
  };
}

async function fetchSportsCardProPrices(searchQuery: string, sportType: string | null): Promise<Partial<PricingResult>> {
  // Only attempt SportsCardPro for sports cards
  if (!sportType || !["baseball", "basketball", "football", "hockey", "soccer"].includes(sportType.toLowerCase())) {
    return { raw: null, psa9: null, psa10: null, suggested: null };
  }

  try {
    // Construct SportsCardPro search URL
    const encodedQuery = encodeURIComponent(searchQuery);
    const sportsCardProUrl = `https://www.sportscardspro.com/search?query=${encodedQuery}`;
    
    console.log("Fetching SportsCardPro prices from:", sportsCardProUrl);
    
    const response = await fetch(sportsCardProUrl, {
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
    
    // Parse prices from HTML
    const prices = extractSportsCardProPrices(html);
    
    return prices;
  } catch (error) {
    console.error("Error fetching SportsCardPro prices:", error);
    return { raw: null, psa9: null, psa10: null, suggested: null };
  }
}

function extractSportsCardProPrices(html: string): { raw: number | null; psa9: number | null; psa10: number | null; suggested: number | null } {
  const prices: number[] = [];
  
  // Extract prices using regex patterns for SportsCardPro
  const pricePatterns = [
    /\$([0-9,]+\.\d{2})/g,
    /price.*?\$([0-9,]+\.\d{2})/gi,
  ];

  for (const pattern of pricePatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const price = parseFloat(match[1].replace(/,/g, ""));
      if (price > 0 && price < 100000) {
        prices.push(price);
      }
    }
  }

  if (prices.length === 0) {
    return { raw: null, psa9: null, psa10: null, suggested: null };
  }

  // Sort and calculate statistics
  prices.sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  return {
    raw: parseFloat(median.toFixed(2)),
    psa9: null, // SportsCardPro may have graded prices in different format
    psa10: null,
    suggested: parseFloat(avg.toFixed(2)),
  };
}
