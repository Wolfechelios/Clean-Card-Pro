import { corsHeaders } from "../_shared/cors.ts";

interface PricingResult {
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  cgc9: number | null;
  cgc10: number | null;
  suggested: number | null;
  // Original median values (before highest raw adjustment)
  medianRaw: number | null;
  medianPsa9: number | null;
  medianPsa10: number | null;
  medianCgc9: number | null;
  medianCgc10: number | null;
  // eBay reference values
  ebayRaw: number | null;
  ebayPsa9: number | null;
  ebayPsa10: number | null;
  ebayCgc9: number | null;
  ebayCgc10: number | null;
  ebayUrl: string | null;
  source: string;
}

interface PriceData {
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  cgc9: number | null;
  cgc10: number | null;
  suggested: number | null;
  // Original median values
  medianRaw: number | null;
  medianPsa9: number | null;
  medianPsa10: number | null;
  medianCgc9: number | null;
  medianCgc10: number | null;
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
    
    // Determine which primary source to use based on card type
    const isTCG = gameType && ["pokemon", "yugioh", "yu-gi-oh", "mtg", "magic"].some(
      type => gameType.toLowerCase().includes(type)
    );
    const isSportsCard = sportType && ["baseball", "basketball", "football", "hockey", "soccer"].includes(
      sportType.toLowerCase()
    );

    // Fetch eBay separately (always as reference)
    const ebayPromise = fetchEbayPrices(searchQuery);
    
    // Fetch primary source based on card type
    let primaryPromise: Promise<PriceData>;
    if (isSportsCard) {
      primaryPromise = fetchSportsCardProPrices(searchQuery);
      sources.push("SportsCardPro");
    } else if (isTCG) {
      primaryPromise = fetchPriceChartingPrices(cardName, cardSet, gameType);
      sources.push("PriceCharting");
    } else {
      // Fallback: try both and use whichever returns data
      const [scp, pc] = await Promise.all([
        fetchSportsCardProPrices(searchQuery),
        fetchPriceChartingPrices(cardName, cardSet, gameType)
      ]);
      primaryPromise = Promise.resolve(scp.raw ? scp : pc);
      sources.push(scp.raw ? "SportsCardPro" : pc.raw ? "PriceCharting" : "None");
    }

    const [primaryPrices, ebayPrices] = await Promise.all([primaryPromise, ebayPromise]);

    // Use primary source for main prices, eBay as separate reference
    const result: PricingResult = {
      // Highest raw values (with 30% markup) from SportsCardPro or PriceCharting
      raw: primaryPrices.raw,
      psa9: primaryPrices.psa9,
      psa10: primaryPrices.psa10,
      cgc9: primaryPrices.cgc9,
      cgc10: primaryPrices.cgc10,
      suggested: primaryPrices.suggested ?? primaryPrices.raw,
      // Original median values (before highest raw adjustment)
      medianRaw: primaryPrices.medianRaw,
      medianPsa9: primaryPrices.medianPsa9,
      medianPsa10: primaryPrices.medianPsa10,
      medianCgc9: primaryPrices.medianCgc9,
      medianCgc10: primaryPrices.medianCgc10,
      // eBay as separate reference
      ebayRaw: ebayPrices.raw,
      ebayPsa9: ebayPrices.psa9,
      ebayPsa10: ebayPrices.psa10,
      ebayCgc9: ebayPrices.cgc9,
      ebayCgc10: ebayPrices.cgc10,
      ebayUrl: ebayPrices.ebayUrl ?? null,
      source: sources.join(" + ") + " (eBay ref)"
    };

    // Fallback to eBay if primary source has no data
    if (result.raw === null && ebayPrices.raw !== null) {
      result.raw = ebayPrices.raw;
      result.psa9 = ebayPrices.psa9;
      result.psa10 = ebayPrices.psa10;
      result.cgc9 = ebayPrices.cgc9;
      result.cgc10 = ebayPrices.cgc10;
      result.suggested = ebayPrices.raw;
      result.medianRaw = ebayPrices.medianRaw;
      result.medianPsa9 = ebayPrices.medianPsa9;
      result.medianPsa10 = ebayPrices.medianPsa10;
      result.medianCgc9 = ebayPrices.medianCgc9;
      result.medianCgc10 = ebayPrices.medianCgc10;
      result.source = "eBay (fallback)";
    }

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
      return { raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, suggested: null, medianRaw: null, medianPsa9: null, medianPsa10: null, medianCgc9: null, medianCgc10: null, ebayUrl };
    }

    const html = await response.text();
    const prices = extractPricesFromHtml(html);
    const gradedPrices = extractGradedPrices(html);
    
    if (prices.length === 0) {
      return { raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, suggested: null, medianRaw: null, medianPsa9: null, medianPsa10: null, medianCgc9: null, medianCgc10: null, ebayUrl };
    }

    const median = getMedian(prices) ?? 0;
    
    // Calculate original median values (before highest raw adjustment)
    const medianPsa9 = gradedPrices.psa9 ?? parseFloat((median * 2.5).toFixed(2));
    const medianPsa10 = gradedPrices.psa10 ?? parseFloat((median * 4).toFixed(2));
    const medianCgc9 = gradedPrices.cgc9 ?? parseFloat((median * 2.2).toFixed(2));
    const medianCgc10 = gradedPrices.cgc10 ?? parseFloat((median * 3.5).toFixed(2));
    
    // Apply 30% for highest raw values
    const markup = 1.30;
    const adjustedMedian = median * markup;
    
    // Use extracted graded prices if available (with highest raw adjustment), otherwise estimate from adjusted raw
    return {
      raw: parseFloat(adjustedMedian.toFixed(2)),
      psa9: parseFloat((medianPsa9 * markup).toFixed(2)),
      psa10: parseFloat((medianPsa10 * markup).toFixed(2)),
      cgc9: parseFloat((medianCgc9 * markup).toFixed(2)),
      cgc10: parseFloat((medianCgc10 * markup).toFixed(2)),
      suggested: parseFloat(adjustedMedian.toFixed(2)),
      // Original median values
      medianRaw: parseFloat(median.toFixed(2)),
      medianPsa9: parseFloat(medianPsa9.toFixed(2)),
      medianPsa10: parseFloat(medianPsa10.toFixed(2)),
      medianCgc9: parseFloat(medianCgc9.toFixed(2)),
      medianCgc10: parseFloat(medianCgc10.toFixed(2)),
      ebayUrl,
    };
  } catch (error) {
    console.error("Error fetching eBay prices:", error);
    return { raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, suggested: null, medianRaw: null, medianPsa9: null, medianPsa10: null, medianCgc9: null, medianCgc10: null, ebayUrl: null };
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
      return { raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, suggested: null, medianRaw: null, medianPsa9: null, medianPsa10: null, medianCgc9: null, medianCgc10: null };
    }

    const html = await response.text();
    const prices = extractPricesFromHtml(html);
    const gradedPrices = extractGradedPrices(html);
    
    if (prices.length === 0 && !gradedPrices.ungraded) {
      return { raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, suggested: null, medianRaw: null, medianPsa9: null, medianPsa10: null, medianCgc9: null, medianCgc10: null };
    }

    const median = getMedian(prices);
    const baseRaw = gradedPrices.ungraded ?? median;
    
    // Apply 30% for highest raw values
    const markup = 1.30;
    const applyMarkup = (val: number | null) => val ? parseFloat((val * markup).toFixed(2)) : null;
    
    return {
      raw: applyMarkup(baseRaw),
      psa9: applyMarkup(gradedPrices.psa9),
      psa10: applyMarkup(gradedPrices.psa10),
      cgc9: applyMarkup(gradedPrices.cgc9),
      cgc10: applyMarkup(gradedPrices.cgc10),
      suggested: applyMarkup(baseRaw),
      // Original median values
      medianRaw: baseRaw ? parseFloat(baseRaw.toFixed(2)) : null,
      medianPsa9: gradedPrices.psa9 ? parseFloat(gradedPrices.psa9.toFixed(2)) : null,
      medianPsa10: gradedPrices.psa10 ? parseFloat(gradedPrices.psa10.toFixed(2)) : null,
      medianCgc9: gradedPrices.cgc9 ? parseFloat(gradedPrices.cgc9.toFixed(2)) : null,
      medianCgc10: gradedPrices.cgc10 ? parseFloat(gradedPrices.cgc10.toFixed(2)) : null,
    };
  } catch (error) {
    console.error("Error fetching SportsCardPro prices:", error);
    return { raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, suggested: null, medianRaw: null, medianPsa9: null, medianPsa10: null, medianCgc9: null, medianCgc10: null };
  }
}

async function fetchPriceChartingPrices(cardName: string, cardSet: string | null, gameType: string | null): Promise<PriceData> {
  try {
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
      return { raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, suggested: null, medianRaw: null, medianPsa9: null, medianPsa10: null, medianCgc9: null, medianCgc10: null };
    }

    const html = await response.text();
    const gradedPrices = extractGradedPrices(html);
    const prices = extractPricesFromHtml(html);
    const median = getMedian(prices);
    const baseRaw = gradedPrices.ungraded ?? median;
    
    // Apply 30% for highest raw values
    const markup = 1.30;
    const applyMarkup = (val: number | null) => val ? parseFloat((val * markup).toFixed(2)) : null;
    
    return {
      raw: applyMarkup(baseRaw),
      psa9: applyMarkup(gradedPrices.psa9),
      psa10: applyMarkup(gradedPrices.psa10),
      cgc9: applyMarkup(gradedPrices.cgc9),
      cgc10: applyMarkup(gradedPrices.cgc10),
      suggested: applyMarkup(baseRaw),
      // Original median values
      medianRaw: baseRaw ? parseFloat(baseRaw.toFixed(2)) : null,
      medianPsa9: gradedPrices.psa9 ? parseFloat(gradedPrices.psa9.toFixed(2)) : null,
      medianPsa10: gradedPrices.psa10 ? parseFloat(gradedPrices.psa10.toFixed(2)) : null,
      medianCgc9: gradedPrices.cgc9 ? parseFloat(gradedPrices.cgc9.toFixed(2)) : null,
      medianCgc10: gradedPrices.cgc10 ? parseFloat(gradedPrices.cgc10.toFixed(2)) : null,
    };
  } catch (error) {
    console.error("Error fetching PriceCharting prices:", error);
    return { raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, suggested: null, medianRaw: null, medianPsa9: null, medianPsa10: null, medianCgc9: null, medianCgc10: null };
  }
}

function getMedian(prices: number[]): number | null {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

function extractGradedPrices(html: string): { 
  ungraded: number | null; 
  psa9: number | null; 
  psa10: number | null; 
  cgc9: number | null; 
  cgc10: number | null;
} {
  let ungraded: number | null = null;
  let psa9: number | null = null;
  let psa10: number | null = null;
  let cgc9: number | null = null;
  let cgc10: number | null = null;

  // Ungraded/Raw prices
  const ungradedMatch = html.match(/ungraded.*?\$([0-9,]+\.\d{2})/i) || html.match(/raw.*?\$([0-9,]+\.\d{2})/i);
  
  // PSA grades
  const psa9Match = html.match(/psa\s*9.*?\$([0-9,]+\.\d{2})/i) || html.match(/grade.*?9.*?\$([0-9,]+\.\d{2})/i);
  const psa10Match = html.match(/psa\s*10.*?\$([0-9,]+\.\d{2})/i) || html.match(/grade.*?10.*?\$([0-9,]+\.\d{2})/i);
  
  // CGC grades
  const cgc9Match = html.match(/cgc\s*9.*?\$([0-9,]+\.\d{2})/i);
  const cgc10Match = html.match(/cgc\s*10.*?\$([0-9,]+\.\d{2})/i) || html.match(/cgc\s*(?:perfect\s*)?10.*?\$([0-9,]+\.\d{2})/i);

  if (ungradedMatch) ungraded = parseFloat(ungradedMatch[1].replace(/,/g, ""));
  if (psa9Match) psa9 = parseFloat(psa9Match[1].replace(/,/g, ""));
  if (psa10Match) psa10 = parseFloat(psa10Match[1].replace(/,/g, ""));
  if (cgc9Match) cgc9 = parseFloat(cgc9Match[1].replace(/,/g, ""));
  if (cgc10Match) cgc10 = parseFloat(cgc10Match[1].replace(/,/g, ""));

  return { ungraded, psa9, psa10, cgc9, cgc10 };
}
