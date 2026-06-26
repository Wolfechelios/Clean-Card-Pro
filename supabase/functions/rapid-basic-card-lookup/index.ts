import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitResponse } from "../_shared/rateLimiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Candidate = {
  name: string;
  url: string;
  source: "pricecharting-set-code" | "google-lens-pricecharting" | "google-web-pricecharting" | "duckduckgo-pricecharting" | "bing-pricecharting";
  score: number;
};

type Pricing = {
  raw: number | null;
  psa8: number | null;
  psa9: number | null;
  psa10: number | null;
  cgc9: number | null;
  cgc10: number | null;
  highestSold: number | null;
  url: string | null;
};

const PC_BASE = "https://www.pricecharting.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      imageUrl,
      ocrText,
      title: titleHint,
      setName: setNameHint,
      setCode: setCodeHint,
      cardNumber: cardNumberHint,
      gameTypeHint,
      allowGoogleLens = true,
    } = body ?? {};
    const authHeader = req.headers.get("authorization");

    if (authHeader) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        const rl = rateLimitResponse(user.id, "rapid-basic-card-lookup", corsHeaders, 90, 60_000);
        if (rl) return rl;
      }
    }

    const normalizedOcr = normalizeSpace(String(ocrText ?? ""));
    const hasStructured = Boolean(titleHint || setCodeHint || cardNumberHint);
    if (!normalizedOcr && !hasStructured) {
      return json({ success: false, source: "none", error: "Missing OCR text and structured hints" }, 400);
    }

    const identifiers = extractIdentifiers(normalizedOcr);
    // Merge in client-provided structured hints so queries are stronger.
    if (titleHint) identifiers.likelyTitle = String(titleHint);
    if (setCodeHint && !identifiers.ygoSetCodes.includes(String(setCodeHint).toUpperCase())) {
      identifiers.ygoSetCodes.unshift(String(setCodeHint).toUpperCase());
    }
    if (cardNumberHint && !identifiers.collectorNumbers.includes(String(cardNumberHint).toUpperCase())) {
      identifiers.collectorNumbers.unshift(String(cardNumberHint).toUpperCase());
    }

    // ── STEP 1: Authoritative identity via YGOPRODeck setcode lookup ──
    // For YGO, the printed code uniquely identifies the printing. Resolve name/set/rarity
    // BEFORE pricing so PriceCharting gets a strong, exact query.
    let ygoIdentity: { name: string; setName: string; setCode: string; rarity: string | null } | null = null;
    for (const code of identifiers.ygoSetCodes) {
      ygoIdentity = await lookupYgoBySetCode(code);
      if (ygoIdentity) {
        console.log("[rapid-basic-card-lookup] YGOPRODeck identified:", code, "→", ygoIdentity.name, "(", ygoIdentity.setName, ")");
        // Promote authoritative title/set so PC queries use the real values.
        identifiers.likelyTitle = ygoIdentity.name;
        if (!setNameHint) (body as any).setName = ygoIdentity.setName;
        break;
      }
    }
    const resolvedSetName = ygoIdentity?.setName ?? setNameHint ?? null;

    const queries = buildPriceChartingQueries(normalizedOcr, identifiers, gameTypeHint, resolvedSetName);
    console.log("[rapid-basic-card-lookup] queries:", JSON.stringify(queries));

    let candidate: Candidate | null = null;
    const tried: string[] = [];

    for (const query of queries) {
      tried.push(`pricecharting:${query}`);
      const found = await searchPriceCharting(query, identifiers);
      if (found) {
        console.log("[rapid-basic-card-lookup] matched on query:", query, "->", found.url);
        candidate = found;
        break;
      }
    }

    let googleLensUrl: string | null = null;
    if (!candidate && allowGoogleLens && isHttpUrl(imageUrl)) {
      googleLensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
      candidate = await searchGoogleLensForPriceCharting(imageUrl, identifiers);
      if (!candidate) {
        for (const query of queries.slice(0, 4)) {
          candidate = await searchGoogleWebForPriceCharting(query, identifiers)
            ?? await searchDuckDuckGoForPriceCharting(query, identifiers)
            ?? await searchBingForPriceCharting(query, identifiers);
          if (candidate) break;
        }
      }
    }

    if (!candidate) {
      console.log("[rapid-basic-card-lookup] no PC match — tried:", tried);
      // If YGOPRODeck gave us authoritative identity, return it even without pricing
      // so the queue processor can attempt fetch-card-prices fallback.
      if (ygoIdentity) {
        return json({
          success: true,
          source: "ygoprodeck",
          cardData: {
            card_name: ygoIdentity.name,
            card_set: ygoIdentity.setName,
            card_number: ygoIdentity.setCode,
            rarity: ygoIdentity.rarity,
            game_type: "YuGiOh",
            sport_type: null,
            year: null,
            manufacturer: "Konami",
            confidence: 0.9,
          },
          pricing: null,
          priceChartingUrl: null,
          googleLensUrl,
          diagnostics: { tried, identifiers, ygoIdentity },
        });
      }
      return json({
        success: false,
        source: "none",
        error: "No PriceCharting product found by set code/title or Lens/web fallback",
        tried,
        googleLensUrl,
      });
    }

    const pageHtml = await fetchText(candidate.url);
    const title = extractProductTitle(pageHtml) || candidate.name;
    const pricing = parsePriceChartingPrices(pageHtml, candidate.url);
    const cardData = productTitleToCardData(title, normalizedOcr, identifiers, gameTypeHint, candidate.score);
    if (resolvedSetName && !cardData.card_set) cardData.card_set = String(resolvedSetName);

    // YGOPRODeck identity is authoritative — overwrite PriceCharting's parsed name/set/rarity.
    if (ygoIdentity) {
      cardData.card_name = ygoIdentity.name;
      cardData.card_set = ygoIdentity.setName;
      cardData.card_number = ygoIdentity.setCode;
      cardData.rarity = ygoIdentity.rarity;
      cardData.game_type = "YuGiOh";
      cardData.manufacturer = "Konami";
      cardData.confidence = Math.max(cardData.confidence, 0.92);
    }

    return json({
      success: true,
      source: candidate.source === "pricecharting-set-code" ? "pricecharting-set-code" : "google-lens-pricecharting",
      cardData,
      pricing,
      priceChartingUrl: candidate.url,
      googleLensUrl,
      diagnostics: { tried, identifiers, ygoIdentity },
    });
  } catch (e) {
    console.error("rapid-basic-card-lookup failed", e);
    return json({ success: false, source: "none", error: String((e as Error)?.message ?? e) }, 500);
  }
});


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[\u0000-\u001F]+/g, " ").trim();
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function extractIdentifiers(text: string) {
  const upper = text.toUpperCase();
  const ygoSetCodes = Array.from(new Set(upper.match(/\b[A-Z0-9]{2,8}-[A-Z]{0,4}\d{1,5}\b/g) ?? []));
  const collectorNumbers = Array.from(new Set(upper.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g)?.map((v) => v.replace(/\s+/g, "")) ?? []));
  const serialNumbers = Array.from(new Set(upper.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g)?.map((v) => v.replace(/\s+/g, "")) ?? []));
  const likelyTitle = inferLikelyTitle(text);
  return { ygoSetCodes, collectorNumbers, serialNumbers, likelyTitle };
}

function inferLikelyTitle(text: string): string | null {
  const lines = text.split(/[\n|•]+|(?<=\.)\s+/).map((l) => normalizeSpace(l)).filter(Boolean);
  const bad = /^(konami|pokemon|wizards|illus\.|©|tm|first edition|1st edition|limited edition|common|rare|spell|trap|effect|monster|basic|stage|hp\b)/i;
  const scored = lines
    .filter((line) => line.length >= 3 && line.length <= 70 && !bad.test(line))
    .map((line) => ({ line, score: titleScore(line) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.line ?? null;
}

function titleScore(line: string): number {
  let score = 0;
  if (/^[A-Z0-9][A-Za-z0-9'’:\- ]+$/.test(line)) score += 2;
  if (/[a-z]/.test(line) && /[A-Z]/.test(line)) score += 1;
  if (/\b[A-Z0-9]{2,8}-[A-Z]{0,4}\d{1,5}\b/.test(line)) score -= 5;
  if (/\$|PSA|CGC|HP\b|ATK|DEF|EN\d/i.test(line)) score -= 2;
  return score;
}

function buildPriceChartingQueries(text: string, ids: ReturnType<typeof extractIdentifiers>, gameTypeHint?: string, setName?: string | null): string[] {
  const out: string[] = [];
  const title = ids.likelyTitle;
  const gameTerms = gameTypeHint && gameTypeHint !== "auto" ? [gameTypeHint] : ["pokemon", "yugioh", "yu gi oh", "mtg", "sports"];

  // 1. set code is the strongest signal for YGO/Pokémon
  for (const code of ids.ygoSetCodes) {
    out.push(code);
    if (title) out.push(`${code} ${title}`);
    out.push(`${code} yugioh`);
  }
  // 2. title + set name
  if (title && setName) {
    out.push(`${title} ${setName}`);
    out.push(`${setName} ${title}`);
  }
  // 3. title + collector number
  for (const number of ids.collectorNumbers) {
    if (title) out.push(`${title} ${number}`);
    for (const game of gameTerms.slice(0, 2)) out.push(`${number} ${game}`);
  }
  // 4. title alone + game hints
  if (title) {
    out.push(title);
    for (const game of gameTerms.slice(0, 3)) out.push(`${title} ${game}`);
  }
  // 5. set name alone as last resort
  if (setName) out.push(setName);
  // 6. raw text shred (legacy)
  if (text) out.push(text.slice(0, 120));
  return unique(out.map((q) => normalizeSpace(q)).filter((q) => q.length >= 2)).slice(0, 14);
}


function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function searchPriceCharting(query: string, ids: ReturnType<typeof extractIdentifiers>): Promise<Candidate | null> {
  const html = await fetchText(`${PC_BASE}/search-products?type=prices&q=${encodeURIComponent(query)}`).catch(() => "");
  return bestPriceChartingLink(html, ids, "pricecharting-set-code");
}

async function searchGoogleLensForPriceCharting(imageUrl: string, ids: ReturnType<typeof extractIdentifiers>): Promise<Candidate | null> {
  const html = await fetchText(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`).catch(() => "");
  return bestPriceChartingLink(html, ids, "google-lens-pricecharting");
}

async function searchGoogleWebForPriceCharting(query: string, ids: ReturnType<typeof extractIdentifiers>): Promise<Candidate | null> {
  const html = await fetchText(`https://www.google.com/search?q=${encodeURIComponent(`site:pricecharting.com/game ${query}`)}`).catch(() => "");
  return bestPriceChartingLink(html, ids, "google-web-pricecharting");
}

async function searchDuckDuckGoForPriceCharting(query: string, ids: ReturnType<typeof extractIdentifiers>): Promise<Candidate | null> {
  const html = await fetchText(`https://duckduckgo.com/html/?q=${encodeURIComponent(`site:pricecharting.com/game ${query}`)}`).catch(() => "");
  return bestPriceChartingLink(html, ids, "duckduckgo-pricecharting");
}

async function searchBingForPriceCharting(query: string, ids: ReturnType<typeof extractIdentifiers>): Promise<Candidate | null> {
  const html = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(`site:pricecharting.com/game ${query}`)}`).catch(() => "");
  return bestPriceChartingLink(html, ids, "bing-pricecharting");
}

function bestPriceChartingLink(html: string, ids: ReturnType<typeof extractIdentifiers>, source: Candidate["source"]): Candidate | null {
  const links = extractPriceChartingLinks(html)
    .filter((link) => /\/game\//.test(link.url) && !/\/console\//.test(link.url));
  if (!links.length) return null;

  const scored = links.map((link) => ({ ...link, source, score: scoreLink(link.name + " " + link.url, ids) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > -2 ? scored[0] : scored[0] ?? null;
}

function extractPriceChartingLinks(html: string): Array<{ name: string; url: string }> {
  const found: Array<{ name: string; url: string }> = [];
  const hrefRe = /href=["']([^"']*pricecharting\.com\/game\/[^"']+|\/game\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html))) {
    const rawUrl = decodeHtml(match[1]);
    const url = rawUrl.startsWith("/") ? `${PC_BASE}${rawUrl}` : rawUrl.replace(/^http:\/\//i, "https://");
    const cleanUrl = url.split("?")[0].split("#")[0];
    const name = normalizeSpace(stripTags(decodeHtml(match[2]))) || decodeURIComponent(cleanUrl.split("/").pop() ?? "").replace(/[-_]+/g, " ");
    found.push({ name, url: cleanUrl });
  }

  const bareRe = /https?:\/\/(?:www\.)?pricecharting\.com\/game\/[^\s"'<>\\]+/gi;
  while ((match = bareRe.exec(html))) {
    const cleanUrl = decodeHtml(match[0]).split("?")[0].split("#")[0];
    const name = decodeURIComponent(cleanUrl.split("/").pop() ?? "").replace(/[-_]+/g, " ");
    found.push({ name, url: cleanUrl });
  }

  const byUrl = new Map<string, { name: string; url: string }>();
  for (const item of found) byUrl.set(item.url, item);
  return Array.from(byUrl.values());
}

function scoreLink(haystack: string, ids: ReturnType<typeof extractIdentifiers>): number {
  const h = haystack.toUpperCase();
  let score = 0;
  for (const code of ids.ygoSetCodes) if (h.includes(code)) score += 12;
  for (const number of ids.collectorNumbers) if (h.includes(number.toUpperCase())) score += 6;
  if (ids.likelyTitle) {
    const title = ids.likelyTitle.toUpperCase();
    for (const part of title.split(/\s+/).filter((p) => p.length > 2)) {
      if (h.includes(part)) score += 1;
    }
    if (h.includes(title)) score += 8;
  }
  return score;
}

function extractProductTitle(html: string): string | null {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return normalizeSpace(stripTags(decodeHtml(h1)));
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  return og ? normalizeSpace(decodeHtml(og)) : null;
}

function parsePriceChartingPrices(html: string, url: string): Pricing {
  const text = normalizeSpace(stripTags(decodeHtml(html)));
  return {
    raw: findLabeledPrice(text, ["Ungraded", "Loose", "Raw"]),
    psa8: findLabeledPrice(text, ["Grade 8", "PSA 8"]),
    psa9: findLabeledPrice(text, ["Grade 9", "PSA 9"]),
    psa10: findLabeledPrice(text, ["Grade 10", "PSA 10", "Gem Mint"]),
    cgc9: findLabeledPrice(text, ["CGC 9"]),
    cgc10: findLabeledPrice(text, ["CGC 10"]),
    highestSold: findLabeledPrice(text, ["Highest", "Historic sales"]),
    url,
  };
}

function findLabeledPrice(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const safe = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${safe}.{0,80}?\\$\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`, "i");
    const hit = text.match(re)?.[1];
    if (hit) return roundMoney(Number(hit.replace(/,/g, "")));
  }
  return null;
}

function roundMoney(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function productTitleToCardData(title: string, ocrText: string, ids: ReturnType<typeof extractIdentifiers>, gameTypeHint?: string, score = 0) {
  const cleanTitle = title.replace(/\s+Prices.*$/i, "").replace(/\s+Price.*$/i, "").trim();
  const parts = cleanTitle.split(/\s+#|\s+-\s+|\s+\|\s+/).map((p) => p.trim()).filter(Boolean);
  const cardNumber = ids.ygoSetCodes[0] ?? ids.collectorNumbers[0] ?? null;
  const inferredGame = inferGameType(ocrText, cleanTitle, gameTypeHint);
  return {
    card_name: parts[0] || cleanTitle,
    card_set: parts.length > 1 ? parts.slice(1).join(" - ") : null,
    card_number: cardNumber,
    rarity: null,
    game_type: inferredGame,
    sport_type: inferredGame === "Sports" ? "unknown" : null,
    year: extractYear(ocrText + " " + cleanTitle),
    manufacturer: inferManufacturer(ocrText + " " + cleanTitle),
    confidence: Math.max(0.35, Math.min(0.98, 0.55 + score / 30)),
  };
}

function inferGameType(ocr: string, title: string, hint?: string): string | null {
  if (hint && hint !== "auto") return hint;
  const h = `${ocr} ${title}`.toLowerCase();
  if (/konami|yugioh|yu-?gi-?oh|spell card|trap card|atk|def/.test(h)) return "YuGiOh";
  if (/pokemon|pokémon|hp\s*\d+|trainer|energy/.test(h)) return "Pokemon";
  if (/magic: the gathering|planeswalker|creature|instant|sorcery/.test(h)) return "MTG";
  if (/topps|panini|upper deck|fleer|donruss|rookie|rc\b/.test(h)) return "Sports";
  return null;
}

function extractYear(text: string): string | null {
  const years = text.match(/\b(19[6-9]\d|20[0-3]\d)\b/g);
  return years?.[0] ?? null;
}

function inferManufacturer(text: string): string | null {
  const h = text.toLowerCase();
  if (h.includes("konami")) return "Konami";
  if (h.includes("pokemon") || h.includes("pokémon")) return "The Pokémon Company";
  if (h.includes("wizards")) return "Wizards of the Coast";
  if (h.includes("topps")) return "Topps";
  if (h.includes("panini")) return "Panini";
  if (h.includes("upper deck")) return "Upper Deck";
  if (h.includes("fleer")) return "Fleer";
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
