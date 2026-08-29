// Free Pokémon TCG lookup (api.pokemontcg.io v2 — no API key required for
// modest request volumes). Printed-number first, name only as confirmation.

const API = "https://api.pokemontcg.io/v2/cards";
const CACHE_PREFIX = "cc_ptcg_v1_";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_GAP_MS = 150;

let lastCall = 0;

export type PokemonCardResult = {
  cardName: string;
  setName?: string;
  setCode?: string;
  collectorNumber?: string;
  rarity?: string;
  priceRaw?: number | null;
  priceHigh?: number | null;
  url?: string | null;
};

type ApiCard = {
  name?: string;
  number?: string;
  rarity?: string;
  set?: { name?: string; ptcgoCode?: string; printedTotal?: number };
  tcgplayer?: { url?: string; prices?: Record<string, { market?: number; high?: number; mid?: number }> };
  cardmarket?: { url?: string; prices?: { averageSellPrice?: number; trendPrice?: number } };
};

function readCache(key: string): PokemonCardResult | null | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { at: number; value: PokemonCardResult | null };
    if (Date.now() - parsed.at > CACHE_TTL_MS) return undefined;
    return parsed.value;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, value: PokemonCardResult | null): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* quota — cache is optional */
  }
}

async function throttle(): Promise<void> {
  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

function pickPrices(card: ApiCard): { raw: number | null; high: number | null } {
  const tcg = card.tcgplayer?.prices ?? {};
  const buckets = ["holofoil", "normal", "reverseHolofoil", "1stEditionHolofoil", "unlimitedHolofoil"];
  for (const bucket of buckets) {
    const entry = tcg[bucket];
    const market = entry?.market ?? entry?.mid;
    if (typeof market === "number" && market > 0) {
      return { raw: market, high: typeof entry?.high === "number" ? entry.high : null };
    }
  }
  const cm = card.cardmarket?.prices;
  const avg = cm?.averageSellPrice ?? cm?.trendPrice;
  return { raw: typeof avg === "number" && avg > 0 ? avg : null, high: null };
}

function toResult(card: ApiCard): PokemonCardResult | null {
  if (!card?.name) return null;
  const prices = pickPrices(card);
  return {
    cardName: card.name,
    setName: card.set?.name,
    setCode: card.set?.ptcgoCode,
    collectorNumber: card.number,
    rarity: card.rarity,
    priceRaw: prices.raw,
    priceHigh: prices.high,
    url: card.tcgplayer?.url ?? card.cardmarket?.url ?? null,
  };
}

async function query(q: string): Promise<PokemonCardResult | null> {
  const cached = readCache(q);
  if (cached !== undefined) return cached;

  await throttle();
  try {
    const res = await fetch(`${API}?q=${encodeURIComponent(q)}&pageSize=5&orderBy=-set.releaseDate`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: ApiCard[] };
    const result = toResult(json.data?.[0] ?? {});
    writeCache(q, result);
    return result;
  } catch {
    return null;
  }
}

/** Pokémon collector lines look like `123/198` — the strongest printed identifier. */
export function parsePokemonNumber(value?: string | null): { number: string; total: string } | null {
  if (!value) return null;
  const match = String(value).match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
  if (!match) return null;
  return { number: match[1].replace(/^0+(?=\d)/, ""), total: match[2].replace(/^0+(?=\d)/, "") };
}

export async function lookupPokemonByPrintedNumber(
  cardNumber?: string | null,
  title?: string | null,
): Promise<PokemonCardResult | null> {
  const parsed = parsePokemonNumber(cardNumber);
  const name = (title ?? "").replace(/[^A-Za-z0-9'\s-]/g, "").trim();

  if (parsed) {
    if (name.length >= 3) {
      const withName = await query(`number:"${parsed.number}" set.printedTotal:${parsed.total} name:"${name}"`);
      if (withName) return withName;
    }
    const byNumber = await query(`number:"${parsed.number}" set.printedTotal:${parsed.total}`);
    if (byNumber) return byNumber;
  }

  if (name.length >= 3) return query(`name:"${name}"`);
  return null;
}
