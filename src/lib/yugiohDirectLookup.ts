import type { RapidBasicLookupResponse } from "@/lib/rapidBasicLookupClient";

const LOCAL_SET_CODE_INDEX_URL = "/data/yugioh-setcode-index.json";
const REMOTE_CARDINFO_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes";

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

let localIndexPromise: Promise<Record<string, LocalYgoPrint>> | null = null;
let remoteIndexPromise: Promise<Record<string, LocalYgoPrint>> | null = null;

function normalizeCode(value: string | null | undefined): string | null {
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

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Lookup database failed: ${res.status}`);
  return res.json();
}

async function getLocalIndex(): Promise<Record<string, LocalYgoPrint>> {
  if (!localIndexPromise) {
    localIndexPromise = fetchJson(LOCAL_SET_CODE_INDEX_URL).then((json) => json && typeof json === "object" ? json : {});
  }
  return localIndexPromise;
}

async function getRemoteIndex(): Promise<Record<string, LocalYgoPrint>> {
  if (!remoteIndexPromise) {
    remoteIndexPromise = fetchJson(REMOTE_CARDINFO_URL).then((json) => {
      const cards = Array.isArray(json?.data) ? json.data : [];
      const index: Record<string, LocalYgoPrint> = {};

      for (const card of cards) {
        for (const set of card.card_sets || []) {
          const setCode = normalizeCode(set?.set_code);
          if (!setCode) continue;
          const price = card.card_prices?.[0] || {};

          index[setCode] = {
            setCode,
            cardName: card.name || null,
            setName: set.set_name || null,
            rarity: set.set_rarity || null,
            setPrice: money(set.set_price),
            imageUrl: card.card_images?.[0]?.image_url || null,
            imageUrlSmall: card.card_images?.[0]?.image_url_small || null,
            tcgplayerPrice: money(price.tcgplayer_price),
            ebayPrice: money(price.ebay_price),
            cardmarketPrice: money(price.cardmarket_price),
            type: card.type || null,
            desc: card.desc || null,
          };
        }
      }

      return index;
    });
  }

  return remoteIndexPromise;
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

export async function lookupYugiohByPrintedCode(setCode: string | null | undefined): Promise<RapidBasicLookupResponse | null> {
  const wanted = normalizeCode(setCode);
  if (!wanted) return null;

  try {
    const localIndex = await getLocalIndex();
    const localPrint = localIndex[wanted];
    if (localPrint) return responseFromPrint(localPrint, wanted, "cache");
  } catch (error) {
    console.warn("[yugiohDirectLookup] Local set-code database unavailable:", error);
  }

  try {
    const remoteIndex = await getRemoteIndex();
    const remotePrint = remoteIndex[wanted];
    if (remotePrint) return responseFromPrint(remotePrint, wanted, "ygoprodeck");

    return {
      success: false,
      source: "ygoprodeck",
      error: `No Yu-Gi-Oh card found for printed code ${wanted}`,
    };
  } catch (error: any) {
    return {
      success: false,
      source: "ygoprodeck",
      error: error?.message || "Yu-Gi-Oh lookup failed",
    };
  }
}
