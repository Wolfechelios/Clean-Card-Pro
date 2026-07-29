import type { RapidBasicLookupResponse } from "@/lib/rapidBasicLookupClient";
import { normalizeYugiohPrintedCode } from "@/lib/yugiohSetCodeIndex";

const REMOTE_CARD_BY_SETCODE_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php";

type LocalYgoPrint = {
  setCode: string;
  cardName: string | null;
  setName: string | null;
  rarity: string | null;
  setPrice: number | null;
  imageUrl: string | null;
  imageUrlSmall: string | null;
  tcgplayerPrice: number | null;
  ebayPrice: number | null;
  cardmarketPrice: number | null;
};

const memoryCache = new Map<string, LocalYgoPrint>();

type ApiRow = Record<string, unknown>;

function isApiRow(value: unknown): value is ApiRow {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function money(value: unknown): number | null {
  const n = Number(String(value ?? "").replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function buildPrint(card: unknown, wantedCode: string): LocalYgoPrint | null {
  if (!isApiRow(card)) return null;
  const sets = Array.isArray(card.card_sets)
    ? card.card_sets.filter(isApiRow)
    : [];
  const match =
    sets.find(
      (set) =>
        normalizeYugiohPrintedCode(String(set.set_code ?? "")) === wantedCode,
    ) ??
    sets[0] ??
    {};
  const prices = Array.isArray(card.card_prices)
    ? card.card_prices.filter(isApiRow)
    : [];
  const images = Array.isArray(card.card_images)
    ? card.card_images.filter(isApiRow)
    : [];
  const price = prices[0] ?? {};
  const image = images[0] ?? {};
  return {
    setCode: wantedCode,
    cardName: text(card.name),
    setName: text(match.set_name),
    rarity: text(match.set_rarity),
    setPrice: money(match.set_price),
    imageUrl: text(image.image_url),
    imageUrlSmall: text(image.image_url_small),
    tcgplayerPrice: money(price.tcgplayer_price),
    ebayPrice: money(price.ebay_price),
    cardmarketPrice: money(price.cardmarket_price),
  };
}

function responseFromPrint(print: LocalYgoPrint, wanted: string, source: "cache" | "ygoprodeck"): RapidBasicLookupResponse {
  return {
    success: true,
    source,
    confidenceTier: "HIGH",
    cardData: {
      card_name: print.cardName,
      card_set: print.setName,
      card_number: print.setCode ?? wanted,
      rarity: print.rarity,
      game_type: "Yu-Gi-Oh",
      sport_type: null,
      year: null,
      manufacturer: "Konami",
      image_url: print.imageUrl,
      image_url_small: print.imageUrlSmall,
      confidence: 0.99,
    },
    pricing: null,
    priceChartingUrl: null,
    googleLensUrl: null,
    requiresDisambiguation: false,
  };
}

export async function lookupYugiohByPrintedCode(setCode: string | null | undefined): Promise<RapidBasicLookupResponse | null> {
  const wanted = normalizeYugiohPrintedCode(setCode);
  if (!wanted) return null;
  if (!/^[A-Z0-9]{2,8}-(?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)?\d{3,5}[A-Z]?$/.test(wanted)) return null;

  const cached = memoryCache.get(wanted);
  if (cached) return responseFromPrint(cached, wanted, "cache");

  try {
    const url = `${REMOTE_CARD_BY_SETCODE_URL}?setcode=${encodeURIComponent(wanted)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const card = Array.isArray(json?.data) ? json.data[0] : null;
    const print = buildPrint(card, wanted);
    if (!print) return null;
    memoryCache.set(wanted, print);
    return responseFromPrint(print, wanted, "ygoprodeck");
  } catch (error) {
    console.warn("[yugiohDirectLookup] printed-code lookup failed:", error);
    return null;
  }
}
