import { corsHeaders } from "../_shared/cors.ts";

interface PricingResult {
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  cgc9: number | null;
  cgc10: number | null;
  suggested: number | null;
  highestSold: number | null;
  medianRaw: number | null;
  medianPsa9: number | null;
  medianPsa10: number | null;
  medianCgc9: number | null;
  medianCgc10: number | null;
  ebayRaw: number | null;
  ebayPsa9: number | null;
  ebayPsa10: number | null;
  ebayCgc9: number | null;
  ebayCgc10: number | null;
  ebayUrl: string | null;
  tcgPlayerPrice: number | null;
  tcgPlayerLow: number | null;
  tcgPlayerMid: number | null;
  tcgPlayerHigh: number | null;
  tcgPlayerMarket: number | null;
  tcgPlayerUrl: string | null;
  source: string;
}

interface SourcePrices {
  raw: number | null;
  psa9: number | null;
  psa10: number | null;
  cgc9: number | null;
  cgc10: number | null;
  highestSold: number | null;
  url: string | null;
}

const emptySource = (): SourcePrices => ({
  raw: null, psa9: null, psa10: null, cgc9: null, cgc10: null, highestSold: null, url: null,
});

// ─── Firecrawl helper ───────────────────────────────────────────────
async function scrapeWithFirecrawl(url: string): Promise<string> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) {
    console.error("FIRECRAWL_API_KEY not set");
    return "";
  }
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
      }),
    });
    if (!resp.ok) {
      console.error(`Firecrawl ${resp.status} for ${url}`);
      return "";
    }
    const data = await resp.json();
    return data?.data?.markdown || data?.markdown || "";
  } catch (e) {
    console.error("Firecrawl error:", e);
    return "";
  }
}

// ─── Price parsing helpers ──────────────────────────────────────────
function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const clean = text.replace(/[,$\s]/g, "");
  const num = parseFloat(clean);
  return isNaN(num) || num <= 0 ? null : parseFloat(num.toFixed(2));
}

function getMedian(prices: number[]): number | null {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── eBay Sold via Firecrawl ────────────────────────────────────────
async function fetchEbayPrices(searchQuery: string): Promise<SourcePrices> {
  try {
    const encoded = encodeURIComponent(searchQuery);
    const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1&_sop=13`;
    console.log("[eBay] Scraping:", ebayUrl);

    const md = await scrapeWithFirecrawl(ebayUrl);
    if (!md) return { ...emptySource(), url: ebayUrl };

    // Extract sold prices from markdown.
    // eBay sold listings in markdown typically show prices like "$12.50" near "Sold" indicators.
    // We look for dollar amounts that appear in sold listing contexts.
    const soldPrices: number[] = [];
    const psa9Prices: number[] = [];
    const psa10Prices: number[] = [];

    // Split into lines and process
    const lines = md.split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      // Skip shipping lines, "to" ranges, or non-listing lines
      if (lower.includes("shipping") || lower.includes("import") || lower.includes("returns")) continue;

      // Extract prices from the line
      const priceMatches = line.match(/\$([0-9,]+(?:\.\d{2})?)/g);
      if (!priceMatches) continue;

      for (const match of priceMatches) {
        const price = parsePrice(match);
        if (!price || price > 50000 || price < 0.01) continue;

        // Categorize by grading context in the line
        if (lower.includes("psa 10") || lower.includes("psa10") || lower.includes("gem mint")) {
          psa10Prices.push(price);
        } else if (lower.includes("psa 9") || lower.includes("psa9") || lower.includes("mint")) {
          psa9Prices.push(price);
        } else {
          soldPrices.push(price);
        }
      }
    }

    const rawMedian = getMedian(soldPrices);
    const psa9Median = getMedian(psa9Prices);
    const psa10Median = getMedian(psa10Prices);
    const allPrices = [...soldPrices, ...psa9Prices, ...psa10Prices];
    const highest = allPrices.length > 0 ? Math.max(...allPrices) : null;

    console.log(`[eBay] Found ${soldPrices.length} raw, ${psa9Prices.length} PSA9, ${psa10Prices.length} PSA10 prices`);

    return {
      raw: rawMedian ? parseFloat(rawMedian.toFixed(2)) : null,
      psa9: psa9Median ? parseFloat(psa9Median.toFixed(2)) : null,
      psa10: psa10Median ? parseFloat(psa10Median.toFixed(2)) : null,
      cgc9: null,
      cgc10: null,
      highestSold: highest ? parseFloat(highest.toFixed(2)) : null,
      url: ebayUrl,
    };
  } catch (e) {
    console.error("[eBay] Error:", e);
    return emptySource();
  }
}

// ─── PriceCharting via Firecrawl ────────────────────────────────────
async function fetchPriceChartingPrices(
  cardName: string,
  cardSet: string | null,
  gameType: string | null
): Promise<SourcePrices> {
  try {
    let category = "pokemon";
    if (gameType) {
      const gt = gameType.toLowerCase();
      if (gt.includes("yugioh") || gt.includes("yu-gi-oh")) category = "yugioh";
      else if (gt.includes("mtg") || gt.includes("magic")) category = "magic-the-gathering";
    }

    // Build a direct card URL slug
    const slug = `${cardName} ${cardSet || ""}`
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");

    const directUrl = `https://www.pricecharting.com/game/${category}/${slug}`;
    console.log("[PriceCharting] Trying direct URL:", directUrl);

    let md = await scrapeWithFirecrawl(directUrl);

    // If direct URL fails (no pricing content), fall back to search
    if (!md || md.length < 200 || !md.match(/\$[0-9]/)) {
      const searchQuery = encodeURIComponent(`${cardName} ${cardSet || ""}`.trim());
      const searchUrl = `https://www.pricecharting.com/search-products?q=${searchQuery}&type=prices&category=${category}`;
      console.log("[PriceCharting] Direct failed, trying search:", searchUrl);
      md = await scrapeWithFirecrawl(searchUrl);

      // Try to extract the first product link from search results and scrape that
      const productLinkMatch = md.match(/\[([^\]]+)\]\((\/game\/[^\)]+)\)/);
      if (productLinkMatch) {
        const productUrl = `https://www.pricecharting.com${productLinkMatch[2]}`;
        console.log("[PriceCharting] Following product link:", productUrl);
        md = await scrapeWithFirecrawl(productUrl);
      }
    }

    if (!md) return emptySource();

    // Parse pricing table from PriceCharting markdown
    // PriceCharting shows prices like: "Ungraded  $2.50" or "| Ungraded | $2.50 |"
    const ungradedMatch = md.match(/(?:ungraded|loose|raw)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa9Match = md.match(/(?:psa\s*9|grade\s*9|graded\s*9)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa10Match = md.match(/(?:psa\s*10|gem\s*mint|grade\s*10)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const cgc9Match = md.match(/(?:cgc\s*9(?:\.5)?)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const cgc10Match = md.match(/(?:cgc\s*10|cgc\s*pristine)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    // Also try "Grade 9" or generic "Graded" if specific not found
    const gradedMatch = !psa9Match ? md.match(/(?:graded)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i) : null;

    const raw = parsePrice(ungradedMatch?.[1] ?? null);
    const psa9 = parsePrice(psa9Match?.[1] ?? gradedMatch?.[1] ?? null);
    const psa10 = parsePrice(psa10Match?.[1] ?? null);

    console.log(`[PriceCharting] Prices — Raw: $${raw}, PSA9: $${psa9}, PSA10: $${psa10}`);

    return {
      raw,
      psa9,
      psa10,
      cgc9: parsePrice(cgc9Match?.[1] ?? null),
      cgc10: parsePrice(cgc10Match?.[1] ?? null),
      highestSold: null,
      url: directUrl,
    };
  } catch (e) {
    console.error("[PriceCharting] Error:", e);
    return emptySource();
  }
}

// ─── TCGPlayer via Firecrawl ────────────────────────────────────────
async function fetchTCGPlayerPrices(
  cardName: string,
  cardSet: string | null,
  cardNumber: string | null,
  gameType: string | null
): Promise<{
  lastSold: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  market: number | null;
  url: string | null;
}> {
  const empty = { lastSold: null, low: null, mid: null, high: null, market: null, url: null };
  try {
    let category = "pokemon";
    if (gameType) {
      const gt = gameType.toLowerCase();
      if (gt.includes("yugioh") || gt.includes("yu-gi-oh")) category = "yugioh";
      else if (gt.includes("mtg") || gt.includes("magic")) category = "magic-the-gathering";
    }

    const parts = [cardName];
    if (cardSet) parts.push(cardSet);
    if (cardNumber) parts.push(cardNumber);
    const query = encodeURIComponent(parts.join(" "));
    const tcgUrl = `https://www.tcgplayer.com/search/${category}/product?q=${query}&view=grid`;

    console.log("[TCGPlayer] Scraping:", tcgUrl);
    let md = await scrapeWithFirecrawl(tcgUrl);
    if (!md) return { ...empty, url: tcgUrl };

    // If we landed on a search page, try to follow the first product link
    if (md.toLowerCase().includes("search results") || !md.match(/market\s*price/i)) {
      // Look for product links in the markdown
      const productMatch = md.match(/\[([^\]]*)\]\((https:\/\/www\.tcgplayer\.com\/product\/[^\)]+)\)/);
      if (productMatch) {
        console.log("[TCGPlayer] Following product link:", productMatch[2]);
        md = await scrapeWithFirecrawl(productMatch[2]);
      }
    }

    if (!md) return { ...empty, url: tcgUrl };

    // TCGPlayer product pages show prices clearly in markdown:
    // "Market Price: $1.23" or "Market Price $1.23"
    // "Listed Median Price: $1.50"
    const marketMatch = md.match(/market\s*price[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);
    const lastSoldMatch = md.match(/(?:last\s*sold|sold\s*for)[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);
    const lowMatch = md.match(/(?:low|tcg\s*low)[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);
    const midMatch = md.match(/(?:mid|median|tcg\s*mid)[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);
    const highMatch = md.match(/(?:high|tcg\s*high)[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);

    // Also try generic price patterns if named patterns fail
    const allPriceMatches = md.match(/\$([0-9,]+\.\d{2})/g);
    let fallbackPrice: number | null = null;
    if (allPriceMatches && allPriceMatches.length > 0) {
      const prices = allPriceMatches.map(p => parsePrice(p)).filter((p): p is number => p !== null && p < 50000);
      fallbackPrice = getMedian(prices);
    }

    const market = parsePrice(marketMatch?.[1] ?? null);
    const lastSold = parsePrice(lastSoldMatch?.[1] ?? null);
    const low = parsePrice(lowMatch?.[1] ?? null);
    const mid = parsePrice(midMatch?.[1] ?? null);
    const high = parsePrice(highMatch?.[1] ?? null);

    console.log(`[TCGPlayer] Market: $${market}, LastSold: $${lastSold}, Low: $${low}, Mid: $${mid}, High: $${high}`);

    return {
      market: market ?? fallbackPrice,
      lastSold,
      low,
      mid,
      high,
      url: tcgUrl,
    };
  } catch (e) {
    console.error("[TCGPlayer] Error:", e);
    return empty;
  }
}

// ─── SportsCardPro via Firecrawl ────────────────────────────────────
async function fetchSportsCardProPrices(searchQuery: string): Promise<SourcePrices> {
  try {
    const encoded = encodeURIComponent(searchQuery);
    const url = `https://www.sportscardspro.com/search?query=${encoded}`;
    console.log("[SportsCardPro] Scraping:", url);

    let md = await scrapeWithFirecrawl(url);
    if (!md) return emptySource();

    // Try to follow first product link
    const productMatch = md.match(/\[([^\]]*)\]\((https?:\/\/www\.sportscardspro\.com\/[^\)]+)\)/);
    if (productMatch) {
      console.log("[SportsCardPro] Following:", productMatch[2]);
      md = await scrapeWithFirecrawl(productMatch[2]);
    }

    if (!md) return emptySource();

    const rawMatch = md.match(/(?:ungraded|raw|loose)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa9Match = md.match(/(?:psa\s*9|grade\s*9)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa10Match = md.match(/(?:psa\s*10|gem\s*mint)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);

    return {
      raw: parsePrice(rawMatch?.[1] ?? null),
      psa9: parsePrice(psa9Match?.[1] ?? null),
      psa10: parsePrice(psa10Match?.[1] ?? null),
      cgc9: null,
      cgc10: null,
      highestSold: null,
      url,
    };
  } catch (e) {
    console.error("[SportsCardPro] Error:", e);
    return emptySource();
  }
}

// ─── Main handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cardName, cardSet, cardNumber, gameType, sportType } = await req.json();
    console.log("Fetching prices for:", { cardName, cardSet, cardNumber, gameType, sportType });

    const searchQuery = `${cardName} ${cardSet || ""} ${cardNumber || ""}`.trim();
    const sources: string[] = [];

    const isTCG = gameType && ["pokemon", "yugioh", "yu-gi-oh", "mtg", "magic"].some(
      (t) => gameType.toLowerCase().includes(t)
    );
    const isSportsCard = sportType && ["baseball", "basketball", "football", "hockey", "soccer"].includes(
      sportType.toLowerCase()
    );

    // Fetch all sources in parallel
    const ebayPromise = fetchEbayPrices(searchQuery);
    const pcPromise = isTCG ? fetchPriceChartingPrices(cardName, cardSet, gameType) : Promise.resolve(emptySource());
    const tcgPromise = isTCG
      ? fetchTCGPlayerPrices(cardName, cardSet, cardNumber, gameType)
      : Promise.resolve({ lastSold: null, low: null, mid: null, high: null, market: null, url: null });
    const scpPromise = isSportsCard ? fetchSportsCardProPrices(searchQuery) : Promise.resolve(emptySource());

    const [ebay, pc, tcg, scp] = await Promise.all([ebayPromise, pcPromise, tcgPromise, scpPromise]);

    // Build sources list
    if (tcg.market || tcg.lastSold) sources.push("TCGPlayer");
    if (pc.raw || pc.psa10) sources.push("PriceCharting");
    if (ebay.raw || ebay.psa10) sources.push("eBay Sold");
    if (scp.raw) sources.push("SportsCardPro");

    // Determine raw price: prefer TCGPlayer market for TCG, else median of available
    const rawCandidates = [tcg.market, tcg.lastSold, pc.raw, ebay.raw, scp.raw].filter(
      (v): v is number => v != null && v > 0
    );
    const rawPrice = getMedian(rawCandidates);

    // PSA9: use actual found prices only — NO multipliers
    const psa9Candidates = [pc.psa9, ebay.psa9, scp.psa9].filter(
      (v): v is number => v != null && v > 0
    );
    const psa9 = getMedian(psa9Candidates);

    // PSA10: use actual found prices only — NO multipliers
    const psa10Candidates = [pc.psa10, ebay.psa10, scp.psa10].filter(
      (v): v is number => v != null && v > 0
    );
    const psa10 = getMedian(psa10Candidates);

    // CGC: from PriceCharting only (only source that reliably reports CGC)
    const cgc9 = pc.cgc9;
    const cgc10 = pc.cgc10;

    // Highest sold across all sources
    const allHighs = [ebay.highestSold, tcg.high, tcg.lastSold].filter(
      (v): v is number => v != null && v > 0
    );
    const highestSold = allHighs.length > 0 ? Math.max(...allHighs) : null;

    const round = (v: number | null) => (v != null ? parseFloat(v.toFixed(2)) : null);

    const result: PricingResult = {
      raw: round(rawPrice),
      psa9: round(psa9),
      psa10: round(psa10),
      cgc9: round(cgc9),
      cgc10: round(cgc10),
      suggested: round(rawPrice),
      highestSold: round(highestSold),
      // Median = same as raw consensus
      medianRaw: round(rawPrice),
      medianPsa9: round(psa9),
      medianPsa10: round(psa10),
      medianCgc9: round(cgc9),
      medianCgc10: round(cgc10),
      // eBay reference
      ebayRaw: round(ebay.raw),
      ebayPsa9: round(ebay.psa9),
      ebayPsa10: round(ebay.psa10),
      ebayCgc9: null,
      ebayCgc10: null,
      ebayUrl: ebay.url,
      // TCGPlayer
      tcgPlayerPrice: round(tcg.lastSold),
      tcgPlayerLow: round(tcg.low),
      tcgPlayerMid: round(tcg.mid),
      tcgPlayerHigh: round(tcg.high),
      tcgPlayerMarket: round(tcg.market),
      tcgPlayerUrl: tcg.url,
      source: sources.length > 0 ? sources.join(" + ") : "No data",
    };

    console.log("Pricing result:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error fetching prices:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
