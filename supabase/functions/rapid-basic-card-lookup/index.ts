import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimitResponse } from "../_shared/rateLimiter.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Universal printed-code-first card lookup.
// Order: cache → authoritative DB (per game) → PriceCharting → web fallback.
// Image AI is invoked only when no printed code resolves.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Game = "yugioh" | "pokemon" | "mtg" | "sports" | "unknown";

type Identity = {
  game: Game;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string | null;
  rarity: string | null;
  manufacturer: string | null;
  year: string | null;
  source: "cache" | "ygoprodeck" | "pokemontcg" | "scryfall";
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

// ─── Service-role client for cache writes ───
function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

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
      edition: editionHint,
      game: gameHint,
      gameTypeHint,
      allowGoogleLens = true,
    } = body ?? {};

    // Rate limiting (per user).
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
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

    // Server-side identity gate. If client passed no valid setCode AND the
    // titleHint is unreadable, refuse to search — junk OCR returns wrong cards.
    const validSetCode = isValidPrintedCodeServer(setCodeHint);
    const validCardNumberCode = isValidPrintedCodeServer(cardNumberHint);
    const validPrintedIdentifier = validSetCode || validCardNumberCode;
    const validTitle = isReadableTitleServer(titleHint);
    if (!validPrintedIdentifier && !validTitle) {
      return json({
        success: false,
        source: "requires_user_disambiguation",
        requiresDisambiguation: true,
        confidenceTier: "LOW",
        error: "Unreadable OCR — no valid set code or title supplied.",
      });
    }

    const ids = extractIdentifiers(normalizedOcr);
    if (titleHint && validTitle) ids.likelyTitle = String(titleHint);
    else ids.likelyTitle = null; // do not use junk text as a search title
    if (setCodeHint && validSetCode && !ids.ygoSetCodes.includes(String(setCodeHint).toUpperCase())) {
      ids.ygoSetCodes.unshift(String(setCodeHint).toUpperCase());
    }
    if (cardNumberHint && validCardNumberCode && String(cardNumberHint).includes("-") && !ids.ygoSetCodes.includes(String(cardNumberHint).toUpperCase())) {
      ids.ygoSetCodes.unshift(String(cardNumberHint).toUpperCase());
    }
    if (cardNumberHint && !ids.collectorNumbers.includes(String(cardNumberHint).toUpperCase())) {
      ids.collectorNumbers.unshift(String(cardNumberHint).toUpperCase());
    }

    const detectedGame: Game = normalizeGame(gameHint) ?? detectGameFromText(normalizedOcr);

    // ── STEP 1: Cache lookup ─────────────────────────────────────────
    let identity: Identity | null = null;
    if (setCodeHint || ids.ygoSetCodes[0]) {
      const code = String(setCodeHint ?? ids.ygoSetCodes[0]);
      identity = await readCache(detectedGame, code, cardNumberHint ?? null);
      if (identity) console.log("[lookup] cache hit:", identity.setCode, "→", identity.name);
    }

    // ── STEP 2: Authoritative database per game ──────────────────────
    if (!identity) {
      if (detectedGame === "yugioh") {
        for (const code of ids.ygoSetCodes) {
          identity = await lookupYgoBySetCode(code);
          if (identity) break;
        }
      } else if (detectedGame === "pokemon") {
        identity = await lookupPokemonByNumber(ids, titleHint ?? null);
      } else if (detectedGame === "mtg") {
        identity = await lookupMtgByCollector(ids, setCodeHint ?? null, cardNumberHint ?? null);
      }
      if (identity) {
        await writeCache(identity).catch(() => undefined);
        console.log("[lookup] authoritative match:", identity.source, identity.setCode, "→", identity.name);
      }
    }

    // Promote authoritative identity into PC query hints.
    if (identity) {
      ids.likelyTitle = identity.name;
      if (!ids.ygoSetCodes.includes(identity.setCode)) ids.ygoSetCodes.unshift(identity.setCode);
    }

    const resolvedSetName = identity?.setName ?? setNameHint ?? null;
    const resolvedRarity = identity?.rarity ?? null;

    if (!identity && detectedGame !== "sports") {
      return json({
        success: false,
        source: "requires_user_disambiguation",
        requiresDisambiguation: true,
        confidenceTier: "LOW",
        error: ids.ygoSetCodes.length > 0
          ? "Printed code was detected but could not be verified by an authoritative card database."
          : "No verifiable printed set/collector code detected. Retake photo closer to the code.",
        diagnostics: { ids },
      });
    }

    // ── STEP 3: Pricing — only after authoritative identity, except sports ──
    const queries = buildPriceChartingQueries(normalizedOcr, ids, gameTypeHint, resolvedSetName, resolvedRarity);
    console.log("[lookup] PC queries:", JSON.stringify(queries.slice(0, 6)));

    let candidate: Candidate | null = null;
    const tried: string[] = [];
    for (const q of queries) {
      tried.push(`pricecharting:${q}`);
      const found = await searchPriceCharting(q, ids);
      if (found) { candidate = found; break; }
    }

    let googleLensUrl: string | null = null;
    // Image AI / Lens fallback — ONLY when no code was resolved.
    const noCodeResolved = !identity && ids.ygoSetCodes.length === 0;
    if (!candidate && allowGoogleLens && isHttpUrl(imageUrl) && noCodeResolved && detectedGame === "sports") {
      googleLensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
      candidate = await searchGoogleLensForPriceCharting(imageUrl, ids);
      if (!candidate) {
        for (const q of queries.slice(0, 3)) {
          candidate = await searchGoogleWebForPriceCharting(q, ids)
            ?? await searchDuckDuckGoForPriceCharting(q, ids)
            ?? await searchBingForPriceCharting(q, ids);
          if (candidate) break;
        }
      }
    }

    // Confidence scoring ────────────────────────────────────────────
    let score = 0;
    if (identity) score += 70;
    if (identity && titleHint && fuzzyMatch(String(titleHint), identity.name) >= 0.7) score += 20;
    if (resolvedRarity && editionHint && resolvedRarity.toLowerCase().includes(String(editionHint).toLowerCase())) score += 10;
    if (candidate && identity && candidate.name.toUpperCase().includes(identity.setCode.toUpperCase())) score += 5;
    if (!identity && ids.ygoSetCodes.length > 0) score -= 50;
    const tier: "HIGH" | "MEDIUM" | "LOW" = score >= 90 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW";

    // No identity AND no candidate AND no usable title → ask the user.
    const titleConfidenceOk = Boolean(titleHint) || Boolean(ids.likelyTitle);
    if (!identity && !candidate && !titleConfidenceOk) {
      return json({
        success: false,
        source: "requires_user_disambiguation",
        requiresDisambiguation: true,
        confidenceTier: "LOW",
        error: "No printed set/collector code detected. User must select the printing.",
        tried,
        googleLensUrl,
      });
    }

    // Identity but no PC candidate → return identity for downstream pricing fallback.
    if (!candidate) {
      if (identity) {
        return json({
          success: true,
          source: identity.source,
          confidenceTier: tier,
          cardData: identityToCardData(identity),
          pricing: null,
          priceChartingUrl: null,
          googleLensUrl,
          diagnostics: { tried, ids, score },
        });
      }
      return json({
        success: false,
        source: "none",
        confidenceTier: "LOW",
        error: "No PriceCharting product found by set code/title.",
        tried,
        googleLensUrl,
      });
    }

    // Parse PriceCharting product page.
    const pageHtml = await fetchText(candidate.url);
    const pcTitle = extractProductTitle(pageHtml) || candidate.name;
    const pricing = parsePriceChartingPrices(pageHtml, candidate.url);
    const cardData = productTitleToCardData(pcTitle, normalizedOcr, ids, gameTypeHint, candidate.score);
    if (resolvedSetName && !cardData.card_set) cardData.card_set = String(resolvedSetName);

    // Authoritative identity overrides PC parser.
    if (identity) {
      cardData.card_name = identity.name;
      cardData.card_set = identity.setName;
      cardData.card_number = identity.collectorNumber ?? identity.setCode;
      cardData.rarity = identity.rarity;
      cardData.game_type = identityGameType(identity.game);
      cardData.manufacturer = identity.manufacturer ?? cardData.manufacturer;
      cardData.year = identity.year ?? cardData.year;
      cardData.confidence = Math.max(cardData.confidence, 0.92);
    }

    return json({
      success: true,
      source: candidate.source === "pricecharting-set-code" ? "pricecharting-set-code" : "google-lens-pricecharting",
      confidenceTier: tier,
      cardData,
      pricing,
      priceChartingUrl: candidate.url,
      googleLensUrl,
      diagnostics: { tried, ids, score },
    });
  } catch (e) {
    console.error("rapid-basic-card-lookup failed", e);
    return json({ success: false, source: "none", error: String((e as Error)?.message ?? e) }, 500);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function normalizeSpace(v: string): string {
  return v.replace(/\s+/g, " ").replace(/[\u0000-\u001F]+/g, " ").trim();
}
function isHttpUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

const SERVER_PRINTED_CODE_RE = /\b(?!ATK\b|DEF\b|HP\b|LP\b)(?:[A-Z0-9]{2,6}-(?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)\d{3,5}|[A-Z]{2,4}-\d{3})\b/i;
const SERVER_POKE_FRACTION_RE = /\b\d{1,4}\s*\/\s*\d{1,4}\b/;
const SERVER_SPORTS_CODE_RE = /\b(?:19[5-9]\d|20[0-3]\d)\s*#\s*\d{1,4}\b/i;
function isValidPrintedCodeServer(s: unknown): boolean {
  if (!s) return false;
  const str = String(s);
  return SERVER_PRINTED_CODE_RE.test(str) || SERVER_POKE_FRACTION_RE.test(str) || SERVER_SPORTS_CODE_RE.test(str);
}
function isReadableTitleServer(s: unknown): boolean {
  if (!s) return false;
  const t = String(s).trim();
  if (t.length < 4) return false;
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 3) return false;
  const nonSpace = t.replace(/\s/g, "");
  if (!nonSpace.length) return false;
  if (letters / nonSpace.length < 0.6) return false;
  return /[A-Za-z]{4,}/.test(t);
}

function normalizeGame(hint?: string | null): Game | null {
  if (!hint) return null;
  const h = String(hint).toLowerCase();
  if (h.includes("yugioh") || h.includes("yu-gi-oh") || h.includes("ygo")) return "yugioh";
  if (h.includes("pokemon") || h.includes("pokémon")) return "pokemon";
  if (h.includes("mtg") || h.includes("magic")) return "mtg";
  if (h.includes("sport") || h.includes("topps") || h.includes("panini")) return "sports";
  return null;
}

function detectGameFromText(text: string): Game {
  const h = text.toLowerCase();
  if (/konami|yu-?gi-?oh|atk\b|def\b|spell card|trap card|effect monster/.test(h)) return "yugioh";
  if (/pokemon|pokémon|hp\s*\d+|trainer|energy|illus\./.test(h)) return "pokemon";
  if (/wizards of the coast|planeswalker|instant|sorcery|enchantment/.test(h)) return "mtg";
  if (/topps|panini|upper deck|fleer|donruss|rookie\b|\brc\b/.test(h)) return "sports";
  return "unknown";
}

function identityGameType(g: Game): string | null {
  if (g === "yugioh") return "YuGiOh";
  if (g === "pokemon") return "Pokemon";
  if (g === "mtg") return "MTG";
  if (g === "sports") return "Sports";
  return null;
}

function identityToCardData(id: Identity) {
  return {
    card_name: id.name,
    card_set: id.setName,
    card_number: id.collectorNumber ?? id.setCode,
    rarity: id.rarity,
    game_type: identityGameType(id.game),
    sport_type: id.game === "sports" ? "unknown" : null,
    year: id.year,
    manufacturer: id.manufacturer,
    confidence: 0.92,
  };
}

function fuzzyMatch(a: string, b: string): number {
  const A = a.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const B = b.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (B.includes(A) || A.includes(B)) return 0.85;
  const at = new Set(A.split(" "));
  const bt = new Set(B.split(" "));
  let common = 0;
  for (const t of at) if (bt.has(t)) common++;
  return common / Math.max(at.size, bt.size);
}

function extractIdentifiers(text: string) {
  const upper = text.toUpperCase();
  const ygoSetCodes = Array.from(new Set(upper.match(/\b(?!ATK\b|DEF\b|HP\b|LP\b)(?:[A-Z0-9]{2,6}-(?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)\d{3,5}|[A-Z]{2,4}-\d{3})\b/g) ?? []));
  const collectorNumbers = Array.from(new Set(upper.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g)?.map((v) => v.replace(/\s+/g, "")) ?? []));
  const serialNumbers = collectorNumbers.slice();
  const likelyTitle = inferLikelyTitle(text);
  return { ygoSetCodes, collectorNumbers, serialNumbers, likelyTitle };
}

function inferLikelyTitle(text: string): string | null {
  const lines = text.split(/[\n|•]+|(?<=\.)\s+/).map((l) => normalizeSpace(l)).filter(Boolean);
  const bad = /^(konami|pokemon|wizards|illus\.|©|tm|first edition|1st edition|limited edition|common|rare|spell|trap|effect|monster|basic|stage|hp\b)/i;
  const scored = lines
    .filter((l) => l.length >= 3 && l.length <= 70 && !bad.test(l))
    .map((l) => ({ l, s: (/^[A-Z0-9][A-Za-z0-9'’:\- ]+$/.test(l) ? 2 : 0) + (/[a-z]/.test(l) && /[A-Z]/.test(l) ? 1 : 0) }))
    .sort((a, b) => b.s - a.s);
  return scored[0]?.l ?? null;
}

function buildPriceChartingQueries(
  text: string,
  ids: ReturnType<typeof extractIdentifiers>,
  gameTypeHint?: string,
  setName?: string | null,
  rarity?: string | null,
): string[] {
  const out: string[] = [];
  const title = ids.likelyTitle;
  const gameTerms = gameTypeHint && gameTypeHint !== "auto" ? [gameTypeHint] : ["yugioh", "pokemon", "mtg"];

  // 1. set code alone
  for (const code of ids.ygoSetCodes) out.push(code);
  // 2. set code + name
  for (const code of ids.ygoSetCodes) if (title) out.push(`${code} ${title}`);
  // 3. name + setName + rarity
  if (title && setName && rarity) out.push(`${title} ${setName} ${rarity}`);
  // 4. name + setName
  if (title && setName) out.push(`${title} ${setName}`);
  // 5. collector number + game
  for (const number of ids.collectorNumbers) {
    if (title) out.push(`${title} ${number}`);
    for (const game of gameTerms.slice(0, 2)) out.push(`${number} ${game}`);
  }
  // 6. title alone
  if (title) out.push(title);
  // 7. set name alone
  if (setName) out.push(setName);

  return unique(out.map((q) => normalizeSpace(q)).filter((q) => q.length >= 2)).slice(0, 12);
}

function unique<T>(items: T[]): T[] { return Array.from(new Set(items)); }

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
  const links = extractPriceChartingLinks(html).filter((l) => /\/game\//.test(l.url) && !/\/console\//.test(l.url));
  if (!links.length) return null;
  const scored = links.map((l) => ({ ...l, source, score: scoreLink(l.name + " " + l.url, ids) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return null;
  // Require structural evidence the link matches the OCR — block junk-query
  // PriceCharting results from being adopted as identity.
  const hasCodeMatch = ids.ygoSetCodes.some((c) => top.url.toUpperCase().includes(c) || top.name.toUpperCase().includes(c));
  if (hasCodeMatch) return top;
  if (ids.likelyTitle) {
    const sim = fuzzyMatch(ids.likelyTitle, top.name);
    if (sim >= 0.7) return top;
  }
  return null;
}

function extractPriceChartingLinks(html: string): Array<{ name: string; url: string }> {
  const found: Array<{ name: string; url: string }> = [];
  const hrefRe = /href=["']([^"']*pricecharting\.com\/game\/[^"']+|\/game\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html))) {
    const raw = decodeHtml(m[1]);
    const url = (raw.startsWith("/") ? `${PC_BASE}${raw}` : raw.replace(/^http:\/\//i, "https://")).split("?")[0].split("#")[0];
    const name = normalizeSpace(stripTags(decodeHtml(m[2]))) || decodeURIComponent(url.split("/").pop() ?? "").replace(/[-_]+/g, " ");
    found.push({ name, url });
  }
  const bareRe = /https?:\/\/(?:www\.)?pricecharting\.com\/game\/[^\s"'<>\\]+/gi;
  while ((m = bareRe.exec(html))) {
    const url = decodeHtml(m[0]).split("?")[0].split("#")[0];
    found.push({ name: decodeURIComponent(url.split("/").pop() ?? "").replace(/[-_]+/g, " "), url });
  }
  const byUrl = new Map<string, { name: string; url: string }>();
  for (const i of found) byUrl.set(i.url, i);
  return Array.from(byUrl.values());
}

function scoreLink(haystack: string, ids: ReturnType<typeof extractIdentifiers>): number {
  const h = haystack.toUpperCase();
  let s = 0;
  for (const code of ids.ygoSetCodes) if (h.includes(code)) s += 12;
  for (const n of ids.collectorNumbers) if (h.includes(n.toUpperCase())) s += 6;
  if (ids.likelyTitle) {
    const t = ids.likelyTitle.toUpperCase();
    for (const p of t.split(/\s+/).filter((p) => p.length > 2)) if (h.includes(p)) s += 1;
    if (h.includes(t)) s += 8;
  }
  return s;
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
    if (hit) return Math.round(Number(hit.replace(/,/g, "")) * 100) / 100;
  }
  return null;
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
    rarity: null as string | null,
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
function extractYear(text: string): string | null { return text.match(/\b(19[6-9]\d|20[0-3]\d)\b/g)?.[0] ?? null; }
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
function decodeHtml(v: string): string {
  return v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// ─── Authoritative resolvers ──────────────────────────────────────────────

async function lookupYgoBySetCode(rawCode: string): Promise<Identity | null> {
  const code = rawCode.trim().toUpperCase();
  if (!/^(?!ATK-|DEF-|HP-|LP-)(?:[A-Z0-9]{2,6}-(?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)\d{3,5}|[A-Z]{2,4}-\d{3})$/.test(code)) return null;
  try {
    const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=${encodeURIComponent(code)}`, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (RapidScan)" },
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.error || !d.name) return null;
    return {
      game: "yugioh",
      name: String(d.name),
      setName: String(d.set_name ?? ""),
      setCode: String(d.set_code ?? code),
      collectorNumber: null,
      rarity: d.set_rarity ? String(d.set_rarity) : null,
      manufacturer: "Konami",
      year: null,
      source: "ygoprodeck",
    };
  } catch (e) {
    console.warn("[ygo] lookup failed:", code, e);
    return null;
  }
}

async function lookupPokemonByNumber(
  ids: ReturnType<typeof extractIdentifiers>,
  titleHint: string | null,
): Promise<Identity | null> {
  // Pokémon TCG API: https://api.pokemontcg.io/v2/cards?q=
  const frac = ids.collectorNumbers[0]; // e.g. "4/102"
  if (!frac) return null;
  const [num, total] = frac.split("/").map((s) => s.trim());
  if (!num) return null;
  const qParts = [`number:"${num}"`];
  if (total) qParts.push(`set.printedTotal:${total}`);
  if (titleHint) qParts.push(`name:"${titleHint.replace(/["\\]/g, "")}"`);
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(qParts.join(" "))}&pageSize=1`;
  try {
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;
    const d = await res.json();
    const card = d?.data?.[0];
    if (!card) return null;
    return {
      game: "pokemon",
      name: String(card.name),
      setName: String(card.set?.name ?? ""),
      setCode: String(card.set?.id ?? "").toUpperCase(),
      collectorNumber: card.number ? `${card.number}${card.set?.printedTotal ? `/${card.set.printedTotal}` : ""}` : null,
      rarity: card.rarity ?? null,
      manufacturer: "The Pokémon Company",
      year: card.set?.releaseDate ? String(card.set.releaseDate).slice(0, 4) : null,
      source: "pokemontcg",
    };
  } catch (e) {
    console.warn("[pokemon] lookup failed:", e);
    return null;
  }
}

async function lookupMtgByCollector(
  ids: ReturnType<typeof extractIdentifiers>,
  setCodeHint: string | null,
  cardNumberHint: string | null,
): Promise<Identity | null> {
  // Scryfall: https://api.scryfall.com/cards/:set/:cn
  let set = setCodeHint?.toLowerCase() ?? null;
  let cn = cardNumberHint ?? ids.collectorNumbers[0] ?? null;
  if (!set && ids.ygoSetCodes[0]) {
    const parts = ids.ygoSetCodes[0].split("-");
    if (parts.length === 2) { set = parts[0].toLowerCase(); cn = cn ?? parts[1]; }
  }
  if (!set || !cn) return null;
  cn = cn.replace(/\D/g, "");
  if (!cn) return null;
  try {
    const res = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(cn)}`, {
      headers: { "Accept": "application/json", "User-Agent": "RapidScan/1.0" },
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || !d.name) return null;
    return {
      game: "mtg",
      name: String(d.name),
      setName: String(d.set_name ?? ""),
      setCode: String(d.set ?? set).toUpperCase(),
      collectorNumber: d.collector_number ?? cn,
      rarity: d.rarity ? String(d.rarity) : null,
      manufacturer: "Wizards of the Coast",
      year: d.released_at ? String(d.released_at).slice(0, 4) : null,
      source: "scryfall",
    };
  } catch (e) {
    console.warn("[mtg] lookup failed:", e);
    return null;
  }
}

// ─── Cache I/O ────────────────────────────────────────────────────────────
async function readCache(game: Game, setCode: string, collectorNumber: string | null): Promise<Identity | null> {
  try {
    const db = adminClient();
    const cn = collectorNumber ?? "";
    const { data } = await db.from("card_print_cache")
      .select("*")
      .eq("game", game)
      .eq("set_code", setCode.toUpperCase())
      .eq("collector_number", cn)
      .maybeSingle();
    if (!data) return null;
    return {
      game: data.game as Game,
      name: data.card_name,
      setName: data.set_name,
      setCode: data.set_code,
      collectorNumber: data.collector_number || null,
      rarity: data.rarity,
      manufacturer: (data.payload as any)?.manufacturer ?? null,
      year: (data.payload as any)?.year ?? null,
      source: "cache",
    };
  } catch (e) {
    console.warn("[cache] read failed:", e);
    return null;
  }
}

async function writeCache(id: Identity): Promise<void> {
  try {
    const db = adminClient();
    await db.from("card_print_cache").upsert({
      game: id.game,
      set_code: id.setCode.toUpperCase(),
      collector_number: id.collectorNumber ?? "",
      card_name: id.name,
      set_name: id.setName,
      rarity: id.rarity,
      external_id: null,
      payload: { manufacturer: id.manufacturer, year: id.year, source: id.source },
      updated_at: new Date().toISOString(),
    }, { onConflict: "game,set_code,collector_number" });
  } catch (e) {
    console.warn("[cache] write failed:", e);
  }
}
