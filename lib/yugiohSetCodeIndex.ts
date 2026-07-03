export type YugiohSetCodeIndexMatch = {
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  setCode: string | null;
  rarity: string | null;
  currentPriceRaw: number | null;
  currentPricePsa9: number | null;
  currentPricePsa10: number | null;
  suggestedPrice: number | null;
  priceChartingUrl: string | null;
  confidence: number;
};

type AnyRow = Record<string, any>;
type NormalizedRow = YugiohSetCodeIndexMatch & { searchName: string; searchSet: string; keys: string[] };

let indexPromise: Promise<NormalizedRow[]> | null = null;
let byCodePromise: Promise<Map<string, NormalizedRow>> | null = null;
const INDEX_URL = "/data/yugioh-setcode-index.json";

function asArray(json: any): AnyRow[] {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.cards)) return json.cards;
  if (Array.isArray(json?.rows)) return json.rows;
  if (Array.isArray(json?.data)) return json.data;
  if (json && typeof json === "object") {
    return Object.entries(json).map(([key, value]) => (value && typeof value === "object" ? { lookupKey: key, ...(value as AnyRow) } : { lookupKey: key, value }));
  }
  return [];
}

function firstString(row: AnyRow, keys: string[]): string | null {
  for (const key of keys) {
    const text = String(row?.[key] ?? "").trim();
    if (text) return text;
  }
  return null;
}

function firstNumber(row: AnyRow, keys: string[]): number | null {
  for (const key of keys) {
    const value = row?.[key];
    if (value == null || value === "") continue;
    const n = Number(String(value).replace(/[$,]/g, ""));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

export function normalizeYugiohPrintedCode(value: string | null | undefined): string | null {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[^A-Z0-9-\s]/g, " ")
    .replace(/\s+/g, "")
    .replace(/--+/g, "-")
    .replace(/([A-Z0-9]{2,8})(EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)(\d{3,5}[A-Z]?)$/, "$1-$2$3");
  if (!raw) return null;
  const withDash = raw.match(/\b([A-Z0-9]{2,12})-?([A-Z]{2})?(\d{2,5}[A-Z]?)\b/);
  if (withDash) return `${withDash[1]}-${withDash[2] ?? ""}${withDash[3]}`;
  return raw.length >= 5 ? raw : null;
}

function normalizeSearch(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function buildKeys(row: AnyRow, cardNumber: string | null, setCode: string | null): string[] {
  const out = new Set<string>();
  const candidates = [row.lookupKey, row.setCode, row.set_code, row.fullCode, row.full_code, row.printedCode, row.printed_code, row.productCode, row.product_code, row.cardNumber, row.card_number, cardNumber, setCode];
  for (const candidate of candidates) {
    const normalized = normalizeYugiohPrintedCode(candidate);
    if (normalized) out.add(normalized);
    const text = String(candidate ?? "").trim().toUpperCase();
    if (text) out.add(text);
  }
  const setOnly = firstString(row, ["setCode", "set_code", "set", "set_abbr", "setAbbr"]);
  if (setOnly && cardNumber) {
    const exact = normalizeYugiohPrintedCode(`${setOnly}-${cardNumber}`);
    if (exact) out.add(exact);
  }
  return Array.from(out).filter(Boolean);
}

function normalizeRow(row: AnyRow): NormalizedRow | null {
  const cardName = firstString(row, ["cardName", "card_name", "name", "title", "product_name"]);
  if (!cardName) return null;
  const cardSet = firstString(row, ["cardSet", "card_set", "setName", "set_name", "set", "collection"]);
  const cardNumber = firstString(row, ["cardNumber", "card_number", "number", "set_number", "printed_number"]);
  const setCode = firstString(row, ["setCode", "set_code", "fullCode", "full_code", "printedCode", "printed_code", "lookupKey"]);
  const rarity = firstString(row, ["rarity", "set_rarity", "variant"]);
  const currentPriceRaw = firstNumber(row, ["currentPriceRaw", "ungraded_price", "raw", "raw_price", "loose_price", "price", "market_price"]);
  const currentPricePsa9 = firstNumber(row, ["currentPricePsa9", "psa9_price", "grade9_price", "graded_price"]);
  const currentPricePsa10 = firstNumber(row, ["currentPricePsa10", "psa10_price", "grade10_price"]);
  const suggestedPrice = firstNumber(row, ["suggestedPrice", "suggested_price", "median_price", "currentPriceRaw", "ungraded_price", "price"]);
  const priceChartingUrl = firstString(row, ["priceChartingUrl", "pricecharting_url", "card_url", "url", "source_url", "product_url"]);
  return { cardName, cardSet, cardNumber, setCode, rarity, currentPriceRaw, currentPricePsa9, currentPricePsa10, suggestedPrice: suggestedPrice ?? currentPriceRaw, priceChartingUrl, confidence: 0, searchName: normalizeSearch(cardName), searchSet: normalizeSearch(cardSet), keys: buildKeys(row, cardNumber, setCode) };
}

async function loadRows(): Promise<NormalizedRow[]> {
  if (typeof window === "undefined") return [];
  if (!indexPromise) {
    indexPromise = fetch(INDEX_URL, { cache: "force-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => asArray(json).map(normalizeRow).filter(Boolean) as NormalizedRow[])
      .catch((error) => {
        console.warn("[yugiohSetCodeIndex] local PriceCharting index not loaded:", error);
        return [];
      });
  }
  return indexPromise;
}

async function loadCodeMap(): Promise<Map<string, NormalizedRow>> {
  if (!byCodePromise) {
    byCodePromise = loadRows().then((rows) => {
      const map = new Map<string, NormalizedRow>();
      for (const row of rows) for (const key of row.keys) if (!map.has(key)) map.set(key, row);
      return map;
    });
  }
  return byCodePromise;
}

function scoreName(needle: string | null | undefined, row: NormalizedRow): number {
  const cleanNeedle = normalizeSearch(needle);
  if (!cleanNeedle) return 0;
  if (cleanNeedle === row.searchName) return 100;
  if (row.searchName.includes(cleanNeedle) || cleanNeedle.includes(row.searchName)) return 88;
  const a = new Set(cleanNeedle.split(" ").filter((w) => w.length > 2));
  const b = new Set(row.searchName.split(" ").filter((w) => w.length > 2));
  if (!a.size || !b.size) return 0;
  let hits = 0;
  a.forEach((word) => { if (b.has(word)) hits += 1; });
  return Math.round((hits / Math.max(a.size, b.size)) * 82);
}

function finish(row: NormalizedRow, confidence: number): YugiohSetCodeIndexMatch {
  return { cardName: row.cardName, cardSet: row.cardSet, cardNumber: row.cardNumber, setCode: row.setCode, rarity: row.rarity, currentPriceRaw: row.currentPriceRaw, currentPricePsa9: row.currentPricePsa9, currentPricePsa10: row.currentPricePsa10, suggestedPrice: row.suggestedPrice, priceChartingUrl: row.priceChartingUrl, confidence };
}

export async function findYugiohSetCodeIndexMatch(args: { setCode?: string | null; cardNumber?: string | null; cardName?: string | null; cardSet?: string | null; rawText?: string | null }): Promise<YugiohSetCodeIndexMatch | null> {
  const codeCandidates = new Set<string>();
  const addCode = (value?: string | null) => { const normalized = normalizeYugiohPrintedCode(value); if (normalized) codeCandidates.add(normalized); };
  addCode(args.setCode);
  addCode(args.cardNumber);
  const rawMatches = String(args.rawText ?? "").match(/[A-Z0-9]{2,12}[\s\-]?(?:[A-Z]{2})?[\s\-]?\d{2,5}[A-Z]?/gi) ?? [];
  rawMatches.forEach(addCode);
  if (args.setCode && args.cardNumber) { addCode(`${args.setCode}-${args.cardNumber}`); addCode(`${args.setCode}${args.cardNumber}`); }

  if (codeCandidates.size) {
    const map = await loadCodeMap();
    for (const code of codeCandidates) {
      const row = map.get(code);
      if (row) return finish(row, 98);
    }
  }

  const name = normalizeSearch(args.cardName);
  if (name.length < 3) return null;
  const rows = await loadRows();
  let best: { row: NormalizedRow; score: number } | null = null;
  for (const row of rows) {
    const nameScore = scoreName(name, row);
    if (nameScore < 55) continue;
    let score = nameScore;
    const wantedSet = normalizeSearch(args.cardSet);
    if (wantedSet && row.searchSet.includes(wantedSet)) score += 8;
    if (!best || score > best.score) best = { row, score };
  }
  return best ? finish(best.row, Math.min(92, best.score)) : null;
}
