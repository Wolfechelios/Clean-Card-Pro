import type { RapidBasicLookupResponse } from "@/lib/rapidBasicLookupClient";

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
  type: string | null;
  desc: string | null;
};

// In-memory cache keyed by normalized printed code (e.g. "MP25-EN318").
const memoryCache = new Map<string, LocalYgoPrint>();

export function normalizeCode(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, "")
    .replace(/([A-Z0-9]{2,8})(EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)(\d{3,5})$/, "$1-$2$3");

  return cleaned.length >= 5 ? cleaned : null;
}

function money(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function buildPrint(card: any, wantedCode: string): LocalYgoPrint | null {
  if (!card) return null;
  const sets: any[] = Array.isArray(card.card_sets) ? card.card_sets : [];
  const match = sets.find((s) => normalizeCode(s?.set_code) === wantedCode) ?? sets[0] ?? {};
  const price = card.card_prices?.[0] ?? {};

  return {
    setCode: wantedCode,
    cardName: card.name ?? null,
    setName: match.set_name ?? null,
    rarity: match.set_rarity ?? null,
    setPrice: money(match.set_price),
    imageUrl: card.card_images?.[0]?.image_url ?? null,
    imageUrlSmall: card.card_images?.[0]?.image_url_small ?? null,
    tcgplayerPrice: money(price.tcgplayer_price),
    ebayPrice: money(price.ebay_price),
    cardmarketPrice: money(price.cardmarket_price),
    type: card.type ?? null,
    desc: card.desc ?? null,
  };
}

function responseFromPrint(print: LocalYgoPrint, wanted: string, source: "cache" | "ygoprodeck"): RapidBasicLookupResponse {
  const raw = money(print.setPrice) ?? money(print.tcgplayerPrice) ?? money(print.ebayPrice) ?? money(print.cardmarketPrice);

  return {
    success: true,
    source,
    confidenceTier: "HIGH",
    cardData: {
      card_name: print.cardName ?? null,
      card_set: print.setName ?? null,
      card_number: print.setCode ?? wanted,
      rarity: print.rarity ?? null,
      game_type: "Yu-Gi-Oh",
      sport_type: null,
      year: null,
      manufacturer: "Konami",
      confidence: 0.99,
    },
    pricing: {
      raw,
      psa8: null,
      psa9: null,
      psa10: null,
      cgc9: null,
      cgc10: null,
      highestSold: raw,
      url: print.imageUrl ?? null,
    },
    priceChartingUrl: print.imageUrl ?? null,
    googleLensUrl: null,
    requiresDisambiguation: false,
  };
}

export async function lookupYugiohByPrintedCode(
  setCode: string | null | undefined,
): Promise<RapidBasicLookupResponse | null> {
  const wanted = normalizeCode(setCode);
  if (!wanted) return null;

  // Only call YGOPRODeck for shapes that look like real YGO printed codes.
  if (!/^[A-Z0-9]{2,8}-(?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)\d{3,5}$/.test(wanted)) {
    return null;
  }

  const cached = memoryCache.get(wanted);
  if (cached) return responseFromPrint(cached, wanted, "cache");

  try {
    const url = `${REMOTE_CARD_BY_SETCODE_URL}?setcode=${encodeURIComponent(wanted)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null; // 400/404 → let edge function take over.
    const json = await res.json();
    const card = Array.isArray(json?.data) ? json.data[0] : null;
    const print = buildPrint(card, wanted);
    if (!print) return null;
    memoryCache.set(wanted, print);
    return responseFromPrint(print, wanted, "ygoprodeck");
  } catch (error) {
    console.warn("[yugiohDirectLookup] Per-code lookup failed:", error);
    return null;
  }
}
