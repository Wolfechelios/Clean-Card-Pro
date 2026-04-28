import { corsHeaders } from "../_shared/cors.ts";

interface PricingResult {
  raw: number | null;
  psa8: number | null;
  psa9: number | null;
  psa10: number | null;
  cgc9: number | null;
  cgc10: number | null;
  suggested: number | null;
  highestSold: number | null;
  medianRaw: number | null;
  medianPsa8: number | null;
  medianPsa9: number | null;
  medianPsa10: number | null;
  medianCgc9: number | null;
  medianCgc10: number | null;
  ebayRaw: number | null;
  ebayPsa8: number | null;
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
  comcRaw: number | null;
  comcUrl: string | null;
  source: string;
}

interface SourcePrices {
  raw: number | null;
  psa8: number | null;
  psa9: number | null;
  psa10: number | null;
  cgc9: number | null;
  cgc10: number | null;
  highestSold: number | null;
  url: string | null;
}

const emptySource = (): SourcePrices => ({
  raw: null, psa8: null, psa9: null, psa10: null, cgc9: null, cgc10: null, highestSold: null, url: null,
});

// ─── Condition helpers ──────────────────────────────────────────────
function isNmMintCondition(condition: string | null | undefined): boolean {
  if (!condition) return false;
  const c = condition.toLowerCase();
  return ["near mint", "nm", "mint", "nm/mint", "nm/m", "near mint/mint"].some(k => c.includes(k));
}

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

// ─── eBay sold-date parser (2-year filter) ──────────────────────────
const TWO_YEARS_MS = 730 * 24 * 60 * 60 * 1000;
function isWithinLast2Years(line: string): boolean {
  // Pattern: "Sold Mar 14, 2024" / "Sold  Jan 2, 2023"
  const match = line.match(/Sold\s+([A-Z][a-z]{2,9})\s+(\d{1,2}),\s+(\d{4})/i);
  if (!match) {
    // No parseable date — keep (Firecrawl sometimes strips dates)
    return true;
  }
  const parsed = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
  if (isNaN(parsed.getTime())) return true;
  const ageMs = Date.now() - parsed.getTime();
  return ageMs <= TWO_YEARS_MS;
}

// ─── eBay Sold via Firecrawl ────────────────────────────────────────
async function fetchEbayPrices(searchQuery: string, condition?: string): Promise<SourcePrices> {
  try {
    const encoded = encodeURIComponent(searchQuery);
    const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1&_sop=13`;
    console.log("[eBay] Scraping:", ebayUrl);

    const md = await scrapeWithFirecrawl(ebayUrl);
    if (!md) return { ...emptySource(), url: ebayUrl };

    const soldPrices: number[] = [];
    const psa8Prices: number[] = [];
    const psa9Prices: number[] = [];
    const psa10Prices: number[] = [];

    const lines = md.split("\n");
    let totalExtracted = 0;
    let droppedOldCount = 0;
    const MAX_PRICES = 15;
    for (const line of lines) {
      if (totalExtracted >= MAX_PRICES) break;
      const lower = line.toLowerCase();
      if (lower.includes("shipping") || lower.includes("import") || lower.includes("returns")) continue;
      if (lower.includes("bid") || lower.includes("watching") || lower.includes("buy it now") || lower.includes("best offer")) continue;

      // 2-year sold filter
      if (!isWithinLast2Years(line)) {
        droppedOldCount++;
        continue;
      }

      const isRawCondition = condition && ["near mint", "nm", "lightly played", "lp", "raw"].some(
        c => condition.toLowerCase().includes(c)
      );
      if (isRawCondition) {
        if (lower.includes("psa") || lower.includes("bgs") || lower.includes("cgc") || lower.includes("graded") || lower.includes("gem mint 10")) continue;
      }

      const priceMatches = line.match(/\$([0-9,]+(?:\.\d{2})?)/g);
      if (!priceMatches) continue;

      for (const match of priceMatches) {
        if (totalExtracted >= MAX_PRICES) break;
        const price = parsePrice(match);
        if (!price || price > 50000 || price < 0.01) continue;

        if (lower.includes("psa 10") || lower.includes("psa10") || lower.includes("gem mint")) {
          psa10Prices.push(price);
        } else if (lower.includes("psa 9") || lower.includes("psa9")) {
          psa9Prices.push(price);
        } else if (lower.includes("psa 8") || lower.includes("psa8") || lower.includes("nm-mt")) {
          psa8Prices.push(price);
        } else {
          soldPrices.push(price);
        }
        totalExtracted++;
      }
    }

    // Intra-source outlier filter
    for (const arr of [soldPrices, psa8Prices, psa9Prices, psa10Prices]) {
      if (arr.length > 1) {
        const lowest = Math.min(...arr);
        if (lowest < 2) {
          const cap = lowest * 20;
          for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i] > cap) arr.splice(i, 1);
          }
        }
      }
    }

    const rawMedian = getMedian(soldPrices);
    const psa8Median = getMedian(psa8Prices);
    const psa9Median = getMedian(psa9Prices);
    const psa10Median = getMedian(psa10Prices);
    const allPrices = [...soldPrices, ...psa8Prices, ...psa9Prices, ...psa10Prices];
    const highest = allPrices.length > 0 ? Math.max(...allPrices) : null;

    console.log(`[eBay] Found ${soldPrices.length} raw, ${psa8Prices.length} PSA8, ${psa9Prices.length} PSA9, ${psa10Prices.length} PSA10 prices (dropped ${droppedOldCount} sales >2y old)`);

    return {
      raw: rawMedian ? parseFloat(rawMedian.toFixed(2)) : null,
      psa8: psa8Median ? parseFloat(psa8Median.toFixed(2)) : null,
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
  gameType: string | null,
  cardNumber: string | null = null
): Promise<SourcePrices> {
  try {
    let category = "pokemon";
    if (gameType) {
      const gt = gameType.toLowerCase();
      if (gt.includes("yugioh") || gt.includes("yu-gi-oh")) category = "yugioh";
      else if (gt.includes("mtg") || gt.includes("magic")) category = "magic-the-gathering";
    }

    const slugParts = [cardName, cardSet || ""];
    if (cardNumber) slugParts.push(cardNumber);
    const slug = slugParts.join(" ")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");

    const directUrl = `https://www.pricecharting.com/game/${category}/${slug}`;
    console.log("[PriceCharting] Trying direct URL:", directUrl);

    let md = await scrapeWithFirecrawl(directUrl);

    if (!md || md.length < 200 || !md.match(/\$[0-9]/)) {
      const searchQuery = encodeURIComponent(`${cardName} ${cardSet || ""}`.trim());
      const searchUrl = `https://www.pricecharting.com/search-products?q=${searchQuery}&type=prices&category=${category}`;
      console.log("[PriceCharting] Direct failed, trying search:", searchUrl);
      md = await scrapeWithFirecrawl(searchUrl);

      const productLinkMatch = md.match(/\[([^\]]+)\]\((\/game\/[^\)]+)\)/);
      if (productLinkMatch) {
        const productUrl = `https://www.pricecharting.com${productLinkMatch[2]}`;
        console.log("[PriceCharting] Following product link:", productUrl);
        md = await scrapeWithFirecrawl(productUrl);
      }
    }

    if (!md) return emptySource();

    const ungradedMatch = md.match(/(?:ungraded|loose|raw)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa8Match = md.match(/(?:psa\s*8|grade\s*8|nm[\s-]*mt)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa9Match = md.match(/(?:psa\s*9|grade\s*9|graded\s*9)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa10Match = md.match(/(?:psa\s*10|gem\s*mint|grade\s*10)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const cgc9Match = md.match(/(?:cgc\s*9(?:\.5)?)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const cgc10Match = md.match(/(?:cgc\s*10|cgc\s*pristine)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const gradedMatch = !psa9Match ? md.match(/(?:graded)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i) : null;

    const raw = parsePrice(ungradedMatch?.[1] ?? null);
    const psa8 = parsePrice(psa8Match?.[1] ?? null);
    const psa9 = parsePrice(psa9Match?.[1] ?? gradedMatch?.[1] ?? null);
    const psa10 = parsePrice(psa10Match?.[1] ?? null);

    console.log(`[PriceCharting] Prices — Raw: $${raw}, PSA8: $${psa8}, PSA9: $${psa9}, PSA10: $${psa10}`);

    return {
      raw,
      psa8,
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

    if (md.toLowerCase().includes("search results") || !md.match(/market\s*price/i)) {
      const productMatch = md.match(/\[([^\]]*)\]\((https:\/\/www\.tcgplayer\.com\/product\/[^\)]+)\)/);
      if (productMatch) {
        console.log("[TCGPlayer] Following product link:", productMatch[2]);
        md = await scrapeWithFirecrawl(productMatch[2]);
      }
    }

    if (!md) return { ...empty, url: tcgUrl };

    const marketMatch = md.match(/market\s*price[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);
    const lastSoldMatch = md.match(/(?:last\s*sold|sold\s*for)[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);
    const lowMatch = md.match(/(?:low|tcg\s*low)[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);
    const midMatch = md.match(/(?:mid|median|tcg\s*mid)[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);
    const highMatch = md.match(/(?:high|tcg\s*high)[:\s]*\$([0-9,]+(?:\.\d{2})?)/i);

    const market = parsePrice(marketMatch?.[1] ?? null);
    const lastSold = parsePrice(lastSoldMatch?.[1] ?? null);
    const low = parsePrice(lowMatch?.[1] ?? null);
    const mid = parsePrice(midMatch?.[1] ?? null);
    const high = parsePrice(highMatch?.[1] ?? null);

    console.log(`[TCGPlayer] Market: $${market}, LastSold: $${lastSold}, Low: $${low}, Mid: $${mid}, High: $${high}`);

    return { market, lastSold, low, mid, high, url: tcgUrl };
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

    const productMatch = md.match(/\[([^\]]*)\]\((https?:\/\/www\.sportscardspro\.com\/[^\)]+)\)/);
    if (productMatch) {
      console.log("[SportsCardPro] Following:", productMatch[2]);
      md = await scrapeWithFirecrawl(productMatch[2]);
    }

    if (!md) return emptySource();

    const rawMatch = md.match(/(?:ungraded|raw|loose)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa8Match = md.match(/(?:psa\s*8|grade\s*8|nm[\s-]*mt)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa9Match = md.match(/(?:psa\s*9|grade\s*9)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);
    const psa10Match = md.match(/(?:psa\s*10|gem\s*mint)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i);

    return {
      raw: parsePrice(rawMatch?.[1] ?? null),
      psa8: parsePrice(psa8Match?.[1] ?? null),
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

// ─── COMC via Firecrawl (MTG + Pokémon only) ───────────────────────
async function fetchCOMCPrices(
  cardName: string,
  cardSet: string | null,
  gameType: string | null,
  sportType: string | null = null
): Promise<SourcePrices> {
  try {
    const gt = (gameType || "").toLowerCase();
    const st = (sportType || "").toLowerCase();
    let category = "";
    if (gt.includes("pokemon")) category = "Pokemon";
    else if (gt.includes("mtg") || gt.includes("magic")) category = "Magic";
    else if (gt.includes("yugioh") || gt.includes("yu-gi-oh")) category = "Yu-Gi-Oh";
    else if (st.includes("baseball") || gt.includes("baseball")) category = "Baseball";
    else if (st.includes("football") || gt.includes("football")) category = "Football";
    else if (st.includes("basketball") || gt.includes("basketball")) category = "Basketball";
    else if (st.includes("hockey") || gt.includes("hockey")) category = "Hockey";
    else if (st.includes("soccer") || gt.includes("soccer")) category = "Soccer";

    const searchTerms = [cardName, cardSet || ""].filter(Boolean).join(" ").trim();
    const encoded = encodeURIComponent(searchTerms);
    const categoryPath = category ? `${category},` : "";
    const comcUrl = `https://www.comc.com/Cards/${categoryPath}=${encoded},vList,i100`;
    console.log("[COMC] Scraping:", comcUrl);

    const md = await scrapeWithFirecrawl(comcUrl);
    if (!md || md.length < 100) return { ...emptySource(), url: comcUrl };

    const rawPrices: number[] = [];
    const psa8Prices: number[] = [];
    const psa9Prices: number[] = [];
    const psa10Prices: number[] = [];
    const cgc9Prices: number[] = [];
    const cgc10Prices: number[] = [];

    // Match card name loosely for filtering
    const nameWords = cardName.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);

    // COMC listings: lines with prices like $XX.XX, condition in brackets [CONDITION]
    const lines = md.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // Check if this line or nearby lines contain the card name
      const context = [lines[i - 1] || "", line, lines[i + 1] || ""].join(" ").toLowerCase();
      const nameMatch = nameWords.length > 0 && nameWords.filter(w => context.includes(w)).length >= Math.min(nameWords.length, 2);
      if (!nameMatch) continue;

      // Extract price
      const priceMatch = line.match(/\$([0-9,]+(?:\.\d{2})?)/);
      if (!priceMatch) continue;
      const price = parsePrice(priceMatch[1]);
      if (!price || price > 50000 || price < 0.01) continue;

      // Extract condition from brackets
      const condMatch = context.match(/\[(.*?)\]/g);
      const condStr = condMatch ? condMatch.map(c => c.toLowerCase()).join(" ") : lower;

      if (condStr.includes("psa 10") || condStr.includes("psa10") || condStr.includes("gem mint 10") || condStr.includes("gem-mt 10")) {
        psa10Prices.push(price);
      } else if (condStr.includes("psa 9") || condStr.includes("psa9") || condStr.includes("mint 9")) {
        psa9Prices.push(price);
      } else if (condStr.includes("psa 8") || condStr.includes("psa8") || condStr.includes("nm-mt 8")) {
        psa8Prices.push(price);
      } else if (condStr.includes("cgc 10") || condStr.includes("cgc10") || condStr.includes("pristine 10")) {
        cgc10Prices.push(price);
      } else if (condStr.includes("cgc 9") || condStr.includes("cgc9")) {
        cgc9Prices.push(price);
      } else if (condStr.includes("bgs") || condStr.includes("sgc")) {
        // skip other grading companies for now
      } else if (condStr.includes("near mint") || condStr.includes("nm") || condStr.includes("mint") || condStr.includes("lightly played") || condStr.includes("lp")) {
        rawPrices.push(price);
      } else if (!condStr.includes("psa") && !condStr.includes("cgc") && !condStr.includes("bgs")) {
        // Ungraded/unknown condition → treat as raw candidate
        rawPrices.push(price);
      }
    }

    console.log(`[COMC] Found ${rawPrices.length} raw, ${psa8Prices.length} PSA8, ${psa9Prices.length} PSA9, ${psa10Prices.length} PSA10 prices`);

    return {
      raw: getMedian(rawPrices) ? parseFloat(getMedian(rawPrices)!.toFixed(2)) : null,
      psa8: getMedian(psa8Prices) ? parseFloat(getMedian(psa8Prices)!.toFixed(2)) : null,
      psa9: getMedian(psa9Prices) ? parseFloat(getMedian(psa9Prices)!.toFixed(2)) : null,
      psa10: getMedian(psa10Prices) ? parseFloat(getMedian(psa10Prices)!.toFixed(2)) : null,
      cgc9: getMedian(cgc9Prices) ? parseFloat(getMedian(cgc9Prices)!.toFixed(2)) : null,
      cgc10: getMedian(cgc10Prices) ? parseFloat(getMedian(cgc10Prices)!.toFixed(2)) : null,
      highestSold: null,
      url: comcUrl,
    };
  } catch (e) {
    console.error("[COMC] Error:", e);
    return emptySource();
  }
}

// ─── Main handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cardName, cardSet, cardNumber, gameType, sportType, condition } = await req.json();
    console.log("Fetching prices for:", { cardName, cardSet, cardNumber, gameType, sportType, condition });

    const conditionTerm = condition && !["unknown", ""].includes(condition.toLowerCase()) ? condition : "";
    const searchQuery = `${cardName} ${cardSet || ""} ${cardNumber || ""} ${conditionTerm}`.replace(/\s+/g, " ").trim();
    const sources: string[] = [];

    const isTCG = gameType && ["pokemon", "yugioh", "yu-gi-oh", "mtg", "magic"].some(
      (t) => gameType.toLowerCase().includes(t)
    );
    const isSportsCard = sportType && ["baseball", "basketball", "football", "hockey", "soccer"].includes(
      sportType.toLowerCase()
    );

    const isMTG = gameType && /mtg|magic/i.test(gameType);
    const isPokemon = gameType && /pokemon|pokémon/i.test(gameType);
    const isYGO = gameType && /yugioh|yu-gi-oh/i.test(gameType);

    // ── Race-to-first-non-null pricing with 3.5s overall cap ──
    // Game-specific priority: skip slow sources unless target source returns null.
    const PRICING_CAP_MS = 3500;

    const raceFirstNonNull = async <T>(
      promises: Array<Promise<T>>,
      isNonNull: (v: T) => boolean,
      capMs: number
    ): Promise<T[]> => {
      // Returns whatever resolved (with non-null preferred) before capMs
      return await new Promise<T[]>((resolve) => {
        const results: T[] = [];
        let resolved = false;
        let pending = promises.length;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          resolve(results);
        };
        const timer = setTimeout(finish, capMs);
        promises.forEach((p) => {
          p.then((v) => {
            results.push(v);
            if (isNonNull(v)) {
              clearTimeout(timer);
              finish();
            }
          })
            .catch(() => {})
            .finally(() => {
              pending--;
              if (pending === 0) {
                clearTimeout(timer);
                finish();
              }
            });
        });
      });
    };

    let ebay: SourcePrices = emptySource();
    let pc: SourcePrices = emptySource();
    let tcg: { lastSold: number | null; low: number | null; mid: number | null; high: number | null; market: number | null; url: string | null } =
      { lastSold: null, low: null, mid: null, high: null, market: null, url: null };
    let scp: SourcePrices = emptySource();
    let comc: SourcePrices = emptySource();

    if (isYGO) {
      // Yu-Gi-Oh! ONLY: TCGPlayer is allowed alongside PriceCharting + eBay
      const pcP = fetchPriceChartingPrices(cardName, cardSet, gameType, cardNumber).then((r) => { pc = r; return r; });
      const tcgP = fetchTCGPlayerPrices(cardName, cardSet, cardNumber, gameType).then((r) => { tcg = r; return r; });
      await raceFirstNonNull(
        [pcP, tcgP],
        (v: any) => (v && (v.raw != null || v.market != null || v.lastSold != null)) as boolean,
        PRICING_CAP_MS
      );
      if (!pc.raw && !tcg.market && !tcg.lastSold) {
        ebay = await Promise.race([
          fetchEbayPrices(searchQuery, condition),
          new Promise<SourcePrices>((r) => setTimeout(() => r(emptySource()), PRICING_CAP_MS)),
        ]);
      }
    } else if (isMTG || isPokemon || isSportsCard) {
      // All other games: eBay + PriceCharting only (no TCGPlayer)
      const [pcRes, ebayRes] = await Promise.all([
        Promise.race([
          fetchPriceChartingPrices(cardName, cardSet, gameType, cardNumber),
          new Promise<SourcePrices>((r) => setTimeout(() => r(emptySource()), PRICING_CAP_MS)),
        ]),
        Promise.race([
          fetchEbayPrices(searchQuery, condition),
          new Promise<SourcePrices>((r) => setTimeout(() => r(emptySource()), PRICING_CAP_MS)),
        ]),
      ]);
      pc = pcRes; ebay = ebayRes;
    } else {
      // Unknown game type: eBay + PriceCharting only
      const [pcRes, ebayRes] = await Promise.all([
        Promise.race([
          fetchPriceChartingPrices(cardName, cardSet, gameType, cardNumber),
          new Promise<SourcePrices>((r) => setTimeout(() => r(emptySource()), PRICING_CAP_MS)),
        ]),
        Promise.race([
          fetchEbayPrices(searchQuery, condition),
          new Promise<SourcePrices>((r) => setTimeout(() => r(emptySource()), PRICING_CAP_MS)),
        ]),
      ]);
      pc = pcRes; ebay = ebayRes;
    }

    // Build sources list
    if (comc.raw || comc.psa10) sources.push("COMC");
    if (pc.raw || pc.psa10) sources.push("PriceCharting");
    if (scp.raw || scp.psa10) sources.push("SportsCardPro");
    if (tcg.market || tcg.lastSold) sources.push("TCGPlayer");
    if (ebay.raw || ebay.psa10) sources.push("eBay Sold");

    // ── Priority-based raw price ─────────────────────────────────────
    let rawPrice: number | null = null;

    if (isSportsCard) {
      // Sports: SportsCardPro → PriceCharting → eBay/TCG fallback
      const primary = scp.raw;
      const secondary = pc.raw;
      const tertiary = [ebay.raw, tcg.market, tcg.lastSold].filter((v): v is number => v != null && v > 0);
      rawPrice = pickPrimaryWithSanity(primary, secondary, tertiary);
    } else if (isMTG) {
      // MTG: PriceCharting → eBay sold (≤2y median) → TCGPlayer → COMC last
      const primary = pc.raw;
      const secondary = ebay.raw;
      const tertiary = [tcg.market, tcg.lastSold, comc.raw].filter((v): v is number => v != null && v > 0);
      rawPrice = pickPrimaryWithSanity(primary, secondary, tertiary);
    } else if (isTCG) {
      // Pokemon/YGO: COMC → TCGPlayer → PriceCharting → eBay fallback
      const primary = comc.raw ?? tcg.market ?? tcg.lastSold;
      const secondary = tcg.market ?? tcg.lastSold ?? comc.raw;
      const tertiary = [pc.raw, ebay.raw].filter((v): v is number => v != null && v > 0);
      rawPrice = pickPrimaryWithSanity(primary, secondary, tertiary);
    } else {
      // Unknown game type: PriceCharting → TCGPlayer → eBay fallback
      const primary = pc.raw;
      const secondary = tcg.market ?? tcg.lastSold;
      const tertiary = [ebay.raw, scp.raw].filter((v): v is number => v != null && v > 0);
      rawPrice = pickPrimaryWithSanity(primary, secondary, tertiary);
    }

    // PSA 8: actual found prices only
    const psa8Candidates = [comc.psa8, pc.psa8, scp.psa8, ebay.psa8].filter(
      (v): v is number => v != null && v > 0
    );
    const psa8 = getMedian(psa8Candidates);

    // PSA 9: actual found prices only
    const psa9Candidates = [comc.psa9, pc.psa9, ebay.psa9, scp.psa9].filter(
      (v): v is number => v != null && v > 0
    );
    const psa9 = getMedian(psa9Candidates);

    // PSA 10: actual found prices only
    const psa10Candidates = [comc.psa10, pc.psa10, ebay.psa10, scp.psa10].filter(
      (v): v is number => v != null && v > 0
    );
    const psa10 = getMedian(psa10Candidates);

    // CGC
    const cgc9Candidates = [comc.cgc9, pc.cgc9].filter((v): v is number => v != null && v > 0);
    const cgc9 = getMedian(cgc9Candidates);
    const cgc10Candidates = [comc.cgc10, pc.cgc10].filter((v): v is number => v != null && v > 0);
    const cgc10 = getMedian(cgc10Candidates);

    // Highest sold
    const allHighs = [ebay.highestSold, tcg.high, tcg.lastSold].filter(
      (v): v is number => v != null && v > 0
    );
    const highestSold = allHighs.length > 0 ? Math.max(...allHighs) : null;

    // ── Suggested price: NM/Mint → PSA 8, else raw ──────────────────
    let suggested = rawPrice;
    if (isNmMintCondition(condition) && psa8 != null) {
      console.log(`[Condition] NM/Mint detected — using PSA 8 price ($${psa8}) as suggested`);
      suggested = psa8;
    }

    const round = (v: number | null) => (v != null ? parseFloat(v.toFixed(2)) : null);

    const result: PricingResult = {
      raw: round(rawPrice),
      psa8: round(psa8),
      psa9: round(psa9),
      psa10: round(psa10),
      cgc9: round(cgc9),
      cgc10: round(cgc10),
      suggested: round(suggested),
      highestSold: round(highestSold),
      medianRaw: round(rawPrice),
      medianPsa8: round(psa8),
      medianPsa9: round(psa9),
      medianPsa10: round(psa10),
      medianCgc9: round(cgc9),
      medianCgc10: round(cgc10),
      ebayRaw: round(ebay.raw),
      ebayPsa8: round(ebay.psa8),
      ebayPsa9: round(ebay.psa9),
      ebayPsa10: round(ebay.psa10),
      ebayCgc9: null,
      ebayCgc10: null,
      ebayUrl: ebay.url,
      tcgPlayerPrice: round(tcg.lastSold),
      tcgPlayerLow: round(tcg.low),
      tcgPlayerMid: round(tcg.mid),
      tcgPlayerHigh: round(tcg.high),
      tcgPlayerMarket: round(tcg.market),
      tcgPlayerUrl: tcg.url,
      comcRaw: round(comc.raw),
      comcUrl: comc.url,
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

// ─── Priority picker with sanity check ──────────────────────────────
function pickPrimaryWithSanity(
  primary: number | null,
  secondary: number | null,
  tertiary: number[]
): number | null {
  const allCandidates = [primary, secondary, ...tertiary].filter(
    (v): v is number => v != null && v > 0
  );
  if (allCandidates.length === 0) return null;

  // If we have a primary, sanity-check it against others
  if (primary != null && primary > 0) {
    const others = [secondary, ...tertiary].filter((v): v is number => v != null && v > 0);
    if (others.length > 0) {
      const othersMedian = getMedian(others)!;
      // Reject primary if it's >5x off from other sources' consensus
      if (primary > othersMedian * 5 || primary < othersMedian / 5) {
        console.log(`[Sanity] Primary $${primary} rejected vs others median $${othersMedian}, using median of all`);
        return parseFloat(getMedian(allCandidates)!.toFixed(2));
      }
    }
    return parseFloat(primary.toFixed(2));
  }

  // No primary — use secondary, else median of tertiary
  if (secondary != null && secondary > 0) return parseFloat(secondary.toFixed(2));
  return getMedian(tertiary) ? parseFloat(getMedian(tertiary)!.toFixed(2)) : null;
}
