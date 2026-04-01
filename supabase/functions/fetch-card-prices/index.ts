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
  // TCGPlayer values (for TCG cards)
  tcgPlayerPrice: number | null;
  tcgPlayerLow: number | null;
  tcgPlayerMid: number | null;
  tcgPlayerHigh: number | null;
  tcgPlayerMarket: number | null;
  tcgPlayerUrl: string | null;
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

interface TCGPlayerPrices {
  lastSold: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  market: number | null;
  url: string | null;
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
    
    // Determine card type
    const isTCG = gameType && ["pokemon", "yugioh", "yu-gi-oh", "mtg", "magic"].some(
      type => gameType.toLowerCase().includes(type)
    );
    const isSportsCard = sportType && ["baseball", "basketball", "football", "hockey", "soccer"].includes(
      sportType.toLowerCase()
    );

    // eBay always as reference
    const ebayPromise = fetchEbayPrices(searchQuery);
    
    // TCGPlayer is now PRIMARY for all TCG cards
    const tcgPlayerPromise = isTCG 
      ? fetchTCGPlayerPrices(cardName, cardSet, cardNumber, gameType)
      : Promise.resolve({ lastSold: null, low: null, mid: null, high: null, market: null, url: null } as TCGPlayerPrices);
    
    // Secondary sources
    let secondaryPromise: Promise<PriceData>;
    if (isSportsCard) {
      secondaryPromise = fetchSportsCardProPrices(searchQuery);
      sources.push("SportsCardPro");
    } else if (isTCG) {
      secondaryPromise = fetchPriceChartingPrices(cardName, cardSet, gameType);
      // PriceCharting is now secondary for TCG
    } else {
      const [scp, pc] = await Promise.all([
        fetchSportsCardProPrices(searchQuery),
        fetchPriceChartingPrices(cardName, cardSet, gameType)
      ]);
      secondaryPromise = Promise.resolve(scp.raw ? scp : pc);
      sources.push(scp.raw ? "SportsCardPro" : pc.raw ? "PriceCharting" : "None");
    }

    const [secondaryPrices, ebayPrices, tcgPlayerPrices] = await Promise.all([
      secondaryPromise, 
      ebayPromise,
      tcgPlayerPromise
    ]);

    // For TCG cards: TCGPlayer is primary, use its market/lastSold as the raw price
    let primaryRaw: number | null = null;
    let primarySource = "";

    if (isTCG && (tcgPlayerPrices.market || tcgPlayerPrices.lastSold)) {
      // TCGPlayer is primary — use market price (or lastSold) as the raw value
      primaryRaw = tcgPlayerPrices.market ?? tcgPlayerPrices.lastSold;
      primarySource = "TCGPlayer";
      sources.unshift("TCGPlayer");
      
      // Add PriceCharting as secondary if it returned data
      if (secondaryPrices.raw) {
        sources.push("PriceCharting");
      }
    } else if (isTCG) {
      // TCGPlayer failed, fall back to PriceCharting
      primaryRaw = secondaryPrices.raw;
      primarySource = "PriceCharting (fallback)";
      sources.push("PriceCharting");
    } else {
      primaryRaw = secondaryPrices.raw;
    }

    // Build result
    const result: PricingResult = {
      // If TCGPlayer is primary for TCG cards, derive graded estimates from TCGPlayer market price
      raw: isTCG && primarySource === "TCGPlayer" 
        ? primaryRaw 
        : secondaryPrices.raw,
      psa9: isTCG && primarySource === "TCGPlayer" && primaryRaw
        ? (secondaryPrices.psa9 ?? parseFloat((primaryRaw * 2.5).toFixed(2)))
        : secondaryPrices.psa9,
      psa10: isTCG && primarySource === "TCGPlayer" && primaryRaw
        ? (secondaryPrices.psa10 ?? parseFloat((primaryRaw * 4).toFixed(2)))
        : secondaryPrices.psa10,
      cgc9: isTCG && primarySource === "TCGPlayer" && primaryRaw
        ? (secondaryPrices.cgc9 ?? parseFloat((primaryRaw * 2.2).toFixed(2)))
        : secondaryPrices.cgc9,
      cgc10: isTCG && primarySource === "TCGPlayer" && primaryRaw
        ? (secondaryPrices.cgc10 ?? parseFloat((primaryRaw * 3.5).toFixed(2)))
        : secondaryPrices.cgc10,
      suggested: primaryRaw ?? secondaryPrices.suggested ?? secondaryPrices.raw,
      // Median values
      medianRaw: isTCG && primarySource === "TCGPlayer"
        ? tcgPlayerPrices.market ?? tcgPlayerPrices.lastSold
        : secondaryPrices.medianRaw,
      medianPsa9: secondaryPrices.medianPsa9,
      medianPsa10: secondaryPrices.medianPsa10,
      medianCgc9: secondaryPrices.medianCgc9,
      medianCgc10: secondaryPrices.medianCgc10,
      // eBay reference
      ebayRaw: ebayPrices.raw,
      ebayPsa9: ebayPrices.psa9,
      ebayPsa10: ebayPrices.psa10,
      ebayCgc9: ebayPrices.cgc9,
      ebayCgc10: ebayPrices.cgc10,
      ebayUrl: ebayPrices.ebayUrl ?? null,
      // TCGPlayer prices (always populated for TCG)
      tcgPlayerPrice: tcgPlayerPrices.lastSold,
      tcgPlayerLow: tcgPlayerPrices.low,
      tcgPlayerMid: tcgPlayerPrices.mid,
      tcgPlayerHigh: tcgPlayerPrices.high,
      tcgPlayerMarket: tcgPlayerPrices.market,
      tcgPlayerUrl: tcgPlayerPrices.url,
      source: sources.join(" + ") + (sources.length > 0 ? " (eBay ref)" : "")
    };

    // Fallback to eBay if no primary or secondary data
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
    
    // No markup — eBay sold prices ARE the market
    return {
      raw: parseFloat(median.toFixed(2)),
      psa9: parseFloat(medianPsa9.toFixed(2)),
      psa10: parseFloat(medianPsa10.toFixed(2)),
      cgc9: parseFloat(medianCgc9.toFixed(2)),
      cgc10: parseFloat(medianCgc10.toFixed(2)),
      suggested: parseFloat(median.toFixed(2)),
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
    
    // No markup — use actual prices
    const round = (val: number | null) => val ? parseFloat(val.toFixed(2)) : null;
    
    return {
      raw: round(baseRaw),
      psa9: round(gradedPrices.psa9),
      psa10: round(gradedPrices.psa10),
      cgc9: round(gradedPrices.cgc9),
      cgc10: round(gradedPrices.cgc10),
      suggested: round(baseRaw),
      medianRaw: round(baseRaw),
      medianPsa9: round(gradedPrices.psa9),
      medianPsa10: round(gradedPrices.psa10),
      medianCgc9: round(gradedPrices.cgc9),
      medianCgc10: round(gradedPrices.cgc10),
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
    
    // No markup — use actual PriceCharting values
    const round = (val: number | null) => val ? parseFloat(val.toFixed(2)) : null;
    
    return {
      raw: round(baseRaw),
      psa9: round(gradedPrices.psa9),
      psa10: round(gradedPrices.psa10),
      cgc9: round(gradedPrices.cgc9),
      cgc10: round(gradedPrices.cgc10),
      suggested: round(baseRaw),
      medianRaw: round(baseRaw),
      medianPsa9: round(gradedPrices.psa9),
      medianPsa10: round(gradedPrices.psa10),
      medianCgc9: round(gradedPrices.cgc9),
      medianCgc10: round(gradedPrices.cgc10),
    };
  } catch (error) {
    console.error("Error fetching PriceCharting prices:", error);
    return { raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, suggested: null, medianRaw: null, medianPsa9: null, medianPsa10: null, medianCgc9: null, medianCgc10: null };
  }
}

async function fetchTCGPlayerPrices(cardName: string, cardSet: string | null, cardNumber: string | null, gameType: string | null): Promise<TCGPlayerPrices> {
  try {
    // Build a precise search query for TCGPlayer
    let category = "pokemon";
    if (gameType) {
      const gt = gameType.toLowerCase();
      if (gt.includes("yugioh") || gt.includes("yu-gi-oh")) category = "yugioh";
      else if (gt.includes("mtg") || gt.includes("magic")) category = "magic-the-gathering";
      else if (gt.includes("pokemon")) category = "pokemon";
    }

    // Try product-specific search first for better accuracy
    const searchParts = [cardName];
    if (cardSet) searchParts.push(cardSet);
    if (cardNumber) searchParts.push(cardNumber);
    const searchQuery = searchParts.join(" ").trim();
    const encodedQuery = encodeURIComponent(searchQuery);
    
    // Use TCGPlayer search with category filter for precision
    const tcgPlayerUrl = `https://www.tcgplayer.com/search/${category}/product?q=${encodedQuery}&view=grid`;
    
    console.log("Fetching TCGPlayer prices from:", tcgPlayerUrl);
    
    const response = await fetch(tcgPlayerUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
    });

    if (!response.ok) {
      console.error("TCGPlayer fetch failed:", response.status);
      // Try fallback: all-category search
      return await fetchTCGPlayerFallback(cardName, cardSet, tcgPlayerUrl);
    }

    const html = await response.text();
    console.log("TCGPlayer HTML length:", html.length);
    
    // Extract prices from TCGPlayer HTML using multiple strategies
    const prices = extractTCGPlayerPrices(html);
    
    // If no prices found from HTML, try the API-style endpoint
    if (!prices.market && !prices.lastSold && !prices.low) {
      console.log("No prices from HTML, trying TCGPlayer API search...");
      return await fetchTCGPlayerAPI(cardName, cardSet, cardNumber, category, tcgPlayerUrl);
    }
    
    return {
      lastSold: prices.lastSold,
      low: prices.low,
      mid: prices.mid,
      high: prices.high,
      market: prices.market,
      url: tcgPlayerUrl,
    };
  } catch (error) {
    console.error("Error fetching TCGPlayer prices:", error);
    return { lastSold: null, low: null, mid: null, high: null, market: null, url: null };
  }
}

async function fetchTCGPlayerAPI(cardName: string, cardSet: string | null, cardNumber: string | null, category: string, fallbackUrl: string): Promise<TCGPlayerPrices> {
  try {
    // TCGPlayer has an internal search API that returns JSON
    const searchParts = [cardName];
    if (cardSet) searchParts.push(cardSet);
    if (cardNumber) searchParts.push(cardNumber);
    const q = searchParts.join(" ").trim();

    const apiUrl = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(q)}&isList=false`;
    
    console.log("Trying TCGPlayer search API:", apiUrl);
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": "https://www.tcgplayer.com",
        "Referer": "https://www.tcgplayer.com/",
      },
      body: JSON.stringify({
        algorithm: "",
        from: 0,
        size: 5,
        filters: {
          term: { productLineName: [category === "magic-the-gathering" ? "magic" : category] },
          range: {},
          match: {},
        },
        listingSearch: {
          filters: { term: {}, range: {}, match: {} },
          context: { cart: {} },
        },
        context: { cart: {}, shippingCountry: "US" },
        settings: {},
        sort: {},
      }),
    });

    if (!response.ok) {
      console.error("TCGPlayer API failed:", response.status);
      return { lastSold: null, low: null, mid: null, high: null, market: null, url: fallbackUrl };
    }

    const data = await response.json();
    console.log("TCGPlayer API response keys:", Object.keys(data));
    
    // Parse API response for pricing data
    const results = data?.results?.[0]?.results || [];
    if (results.length === 0) {
      return { lastSold: null, low: null, mid: null, high: null, market: null, url: fallbackUrl };
    }

    // Find best matching result
    const first = results[0];
    const marketPrice = first?.marketPrice ?? first?.lowestPrice ?? null;
    const lowPrice = first?.lowestPrice ?? first?.lowestListingPrice ?? null;
    
    // Apply 30% markup
    const markup = 1.30;
    const applyMarkup = (val: number | null) => val ? parseFloat((val * markup).toFixed(2)) : null;

    const productUrl = first?.productId 
      ? `https://www.tcgplayer.com/product/${first.productId}` 
      : fallbackUrl;

    return {
      lastSold: applyMarkup(marketPrice),
      low: applyMarkup(lowPrice),
      mid: applyMarkup(first?.midPrice ?? null),
      high: applyMarkup(first?.highPrice ?? null),
      market: applyMarkup(marketPrice),
      url: productUrl,
    };
  } catch (error) {
    console.error("TCGPlayer API error:", error);
    return { lastSold: null, low: null, mid: null, high: null, market: null, url: fallbackUrl };
  }
}

async function fetchTCGPlayerFallback(cardName: string, cardSet: string | null, originalUrl: string): Promise<TCGPlayerPrices> {
  try {
    // Fallback: broader search without category filter
    const searchQuery = `${cardName} ${cardSet || ""}`.trim();
    const encodedQuery = encodeURIComponent(searchQuery);
    const url = `https://www.tcgplayer.com/search/all/product?q=${encodedQuery}&view=grid`;
    
    console.log("TCGPlayer fallback search:", url);
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return { lastSold: null, low: null, mid: null, high: null, market: null, url: originalUrl };
    }

    const html = await response.text();
    const prices = extractTCGPlayerPrices(html);
    
    return {
      lastSold: prices.lastSold,
      low: prices.low,
      mid: prices.mid,
      high: prices.high,
      market: prices.market,
      url: url,
    };
  } catch (error) {
    console.error("TCGPlayer fallback error:", error);
    return { lastSold: null, low: null, mid: null, high: null, market: null, url: originalUrl };
  }
}

function extractTCGPlayerPrices(html: string): {
  lastSold: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  market: number | null;
} {
  let lastSold: number | null = null;
  let low: number | null = null;
  let mid: number | null = null;
  let high: number | null = null;
  let market: number | null = null;

  // Strategy 1: JSON-LD structured data (most reliable)
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const block of jsonLdMatch) {
      try {
        const jsonStr = block.replace(/<\/?script[^>]*>/gi, "");
        const jsonData = JSON.parse(jsonStr);
        if (jsonData?.offers?.price) {
          const price = parseFloat(jsonData.offers.price);
          if (price > 0) {
            market = price;
            lastSold = price;
          }
        }
        if (jsonData?.offers?.lowPrice) {
          low = parseFloat(jsonData.offers.lowPrice);
        }
        if (jsonData?.offers?.highPrice) {
          high = parseFloat(jsonData.offers.highPrice);
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // Strategy 2: __NEXT_DATA__ JSON (TCGPlayer uses Next.js)
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const props = nextData?.props?.pageProps;
      if (props?.product) {
        const product = props.product;
        market = market ?? product.marketPrice ?? null;
        low = low ?? product.lowestPrice ?? product.lowPrice ?? null;
        mid = mid ?? product.midPrice ?? null;
        high = high ?? product.highPrice ?? null;
        lastSold = lastSold ?? market;
      }
      // Search results page
      if (props?.results) {
        const firstResult = props.results[0];
        if (firstResult) {
          market = market ?? firstResult.marketPrice ?? null;
          low = low ?? firstResult.lowestPrice ?? null;
          lastSold = lastSold ?? market;
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // Strategy 3: data attributes and meta tags
  const metaPriceMatch = html.match(/content="([0-9.]+)"[^>]*property="product:price:amount"/i)
    || html.match(/property="product:price:amount"[^>]*content="([0-9.]+)"/i);
  if (metaPriceMatch && !market) {
    market = parseFloat(metaPriceMatch[1]);
    lastSold = lastSold ?? market;
  }

  // Strategy 4: Regex patterns for visible text
  const marketMatch = html.match(/market\s*(?:price)?[:\s]*\$([0-9,]+\.?\d*)/i) 
    || html.match(/"marketPrice"[:\s]*([0-9.]+)/i)
    || html.match(/data-market-price="([0-9.]+)"/i);
  
  const lowMatch = html.match(/(?:low|lowest)\s*(?:price)?[:\s]*\$([0-9,]+\.?\d*)/i)
    || html.match(/"lowPrice"[:\s]*([0-9.]+)/i)
    || html.match(/"lowestPrice"[:\s]*([0-9.]+)/i);
  
  const midMatch = html.match(/mid\s*(?:price)?[:\s]*\$([0-9,]+\.?\d*)/i)
    || html.match(/"midPrice"[:\s]*([0-9.]+)/i);
  
  const highMatch = html.match(/high\s*(?:price)?[:\s]*\$([0-9,]+\.?\d*)/i)
    || html.match(/"highPrice"[:\s]*([0-9.]+)/i);
  
  const lastSoldMatch = html.match(/last\s*sold[:\s]*\$([0-9,]+\.?\d*)/i)
    || html.match(/sold\s*for[:\s]*\$([0-9,]+\.?\d*)/i)
    || html.match(/"lastSoldPrice"[:\s]*([0-9.]+)/i);

  // Listing price from product cards
  const priceCardMatch = html.match(/listing-item__price[^>]*>\s*\$([0-9,]+\.?\d*)/i)
    || html.match(/product-card__market-price[^>]*>\s*\$([0-9,]+\.?\d*)/i)
    || html.match(/search-result__market-price[^>]*>\s*\$([0-9,]+\.?\d*)/i);
  
  if (marketMatch && !market) market = parseFloat(marketMatch[1].replace(/,/g, ""));
  if (lowMatch && !low) low = parseFloat(lowMatch[1].replace(/,/g, ""));
  if (midMatch && !mid) mid = parseFloat(midMatch[1].replace(/,/g, ""));
  if (highMatch && !high) high = parseFloat(highMatch[1].replace(/,/g, ""));
  if (lastSoldMatch && !lastSold) lastSold = parseFloat(lastSoldMatch[1].replace(/,/g, ""));
  
  if (priceCardMatch && !market && !low) {
    const cardPrice = parseFloat(priceCardMatch[1].replace(/,/g, ""));
    if (cardPrice > 0) {
      market = market ?? cardPrice;
      lastSold = lastSold ?? cardPrice;
    }
  }

  // If no last sold, use market price as fallback
  if (!lastSold && market) lastSold = market;
  
  // Apply 30% markup to all TCGPlayer prices
  const markup = 1.30;
  const applyMarkup = (val: number | null) => val ? parseFloat((val * markup).toFixed(2)) : null;

  return {
    lastSold: applyMarkup(lastSold),
    low: applyMarkup(low),
    mid: applyMarkup(mid),
    high: applyMarkup(high),
    market: applyMarkup(market),
  };
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
