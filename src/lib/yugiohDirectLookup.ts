import type { RapidBasicLookupResponse } from "@/lib/rapidBasicLookupClient";

const CARDINFO_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes";

let ygoCardInfoPromise: Promise<any[]> | null = null;

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

async function getYgoCards(): Promise<any[]> {
  if (!ygoCardInfoPromise) {
    ygoCardInfoPromise = fetch(CARDINFO_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`YGOPRODeck lookup failed: ${res.status}`);
        return res.json();
      })
      .then((json) => Array.isArray(json?.data) ? json.data : []);
  }

  return ygoCardInfoPromise;
}

export async function lookupYugiohByPrintedCode(setCode: string | null | undefined): Promise<RapidBasicLookupResponse | null> {
  const wanted = normalizeCode(setCode);
  if (!wanted) return null;

  try {
    const cards = await getYgoCards();

    for (const card of cards) {
      const cardSets = Array.isArray(card?.card_sets) ? card.card_sets : [];
      const exactSet = cardSets.find((set: any) => normalizeCode(set?.set_code) === wanted);
      if (!exactSet) continue;

      const cardPrice = Array.isArray(card?.card_prices) ? card.card_prices[0] : null;
      const raw = money(exactSet.set_price) ?? money(cardPrice?.tcgplayer_price) ?? money(cardPrice?.ebay_price) ?? money(cardPrice?.cardmarket_price);

      return {
        success: true,
        source: "ygoprodeck",
        confidenceTier: "HIGH",
        cardData: {
          card_name: card?.name ?? null,
          card_set: exactSet?.set_name ?? null,
          card_number: exactSet?.set_code ?? wanted,
          rarity: exactSet?.set_rarity ?? null,
          game_type: "Yu-Gi-Oh",
          sport_type: null,
          year: null,
          manufacturer: "Konami",
          confidence: 0.98,
        },
        pricing: {
          raw,
          psa8: null,
          psa9: null,
          psa10: null,
          cgc9: null,
          cgc10: null,
          highestSold: raw,
          url: card?.ygoprodeck_url ?? null,
        },
        priceChartingUrl: card?.ygoprodeck_url ?? null,
        googleLensUrl: null,
        requiresDisambiguation: false,
      };
    }

    return {
      success: false,
      source: "ygoprodeck",
      error: `No Yu-Gi-Oh card found for printed code ${wanted}`,
    };
  } catch (error: any) {
    return {
      success: false,
      source: "ygoprodeck",
      error: error?.message || "Yu-Gi-Oh direct lookup failed",
    };
  }
}
