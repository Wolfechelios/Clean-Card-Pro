// src/lib/mtg/scryfallLookup.ts
// Client-side Magic: The Gathering resolver. Printed set code + collector number first,
// fuzzy card name as fallback. No backend, no API key.

export type ScryfallCard = {
  cardName: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: string | null;
  finish: string | null;
  priceUsd: number | null;
  priceUsdFoil: number | null;
  scryfallUrl: string | null;
};

const API = "https://api.scryfall.com";
const CACHE_PREFIX = "mtg-scryfall:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REQUEST_GAP_MS = 120;

let lastRequestAt = 0;
let requestChain: Promise<void> = Promise.resolve();

/** Serialize + space out requests: Scryfall asks for ~100ms between calls. */
function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const run = requestChain.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  requestChain = run.catch(() => undefined);
  return run.then(fn);
}

function readCache(key: string): ScryfallCard | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; card: ScryfallCard };
    if (!parsed?.card || Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.card;
  } catch {
    return null;
  }
}

function writeCache(key: string, card: ScryfallCard): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), card }));
  } catch {
    // storage full / disabled — cache is best-effort
  }
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapCard(data: any): ScryfallCard | null {
  if (!data || data.object === "error" || !data.name) return null;
  const prices = data.prices ?? {};
  return {
    cardName: String(data.name),
    setName: String(data.set_name ?? ""),
    setCode: String(data.set ?? "").toUpperCase(),
    collectorNumber: String(data.collector_number ?? ""),
    rarity: data.rarity ? String(data.rarity) : null,
    finish: Array.isArray(data.finishes) ? String(data.finishes[0] ?? "") || null : null,
    priceUsd: toNumber(prices.usd),
    priceUsdFoil: toNumber(prices.usd_foil),
    scryfallUrl: data.scryfall_uri ? String(data.scryfall_uri) : null,
  };
}

async function getJson(url: string): Promise<any | null> {
  return rateLimited(async () => {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn("[Scryfall] request failed:", error);
      return null;
    }
  });
}

/** Exact lookup by printed set code + collector number (the reliable path). */
export async function lookupMtgByPrintedCode(
  setCode: string | null | undefined,
  collectorNumber: string | null | undefined,
): Promise<ScryfallCard | null> {
  const set = String(setCode ?? "").trim().toLowerCase();
  const num = String(collectorNumber ?? "").trim().replace(/^0+(?=\d)/, "");
  if (!/^[a-z0-9]{3,5}$/.test(set) || !num) return null;

  const key = `code:${set}/${num}`;
  const cached = readCache(key);
  if (cached) return cached;

  const data = await getJson(`${API}/cards/${encodeURIComponent(set)}/${encodeURIComponent(num)}`);
  const card = mapCard(data);
  if (card) writeCache(key, card);
  return card;
}

/** Fallback lookup by card title when no collector line was readable. */
export async function lookupMtgByName(name: string | null | undefined): Promise<ScryfallCard | null> {
  const title = String(name ?? "").trim();
  if (title.length < 3) return null;

  const key = `name:${title.toLowerCase()}`;
  const cached = readCache(key);
  if (cached) return cached;

  const data = await getJson(`${API}/cards/named?fuzzy=${encodeURIComponent(title)}`);
  const card = mapCard(data);
  if (card) writeCache(key, card);
  return card;
}
