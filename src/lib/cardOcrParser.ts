import { supabase } from "@/integrations/supabase/client";

export type ParsedCardOcr = {
  cardName: string;
  cardSet: string;
  cardNumber: string;
  setCode: string;
  confidence: number;
  rawText: string;
};

export type PriceChartingCardMatch = {
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  rarity: string | null;
  currentPriceRaw: number | null;
  currentPricePsa9: number | null;
  currentPricePsa10: number | null;
  suggestedPrice: number | null;
  priceChartingUrl: string | null;
  confidence: number;
  source: "pricecharting-local";
};

const YUGIOH_SET_NUMBER_RE = /\b([A-Z0-9]{2,10})[-\s]?([A-Z]{2})[-\s]?(\d{2,4}[A-Z]?)\b/i;
const SIMPLE_NUMBER_RE = /(?:#|no\.?|number)?\s*\b(\d{1,4}[A-Z]?)\b/i;
const NOISE_WORDS = /\b(1st|edition|limited|unlimited|konami|yugioh|yu-gi-oh|trading|card|game|spell|trap|effect|monster|warrior|dragon|machine|aqua|beast|fiend|fairy|zombie|pyro|rock|winged|divine|normal|quick-play|continuous|counter|field|equip|atk|def|level|rank|link)\b/gi;

export function cleanCardName(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(NOISE_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(line: string): string {
  return line.replace(/^[^a-z0-9]+/i, "").replace(/\s+/g, " ").trim();
}

export function parseYugiohOcrText(rawText: string | null | undefined): ParsedCardOcr {
  const text = String(rawText || "");
  const lines = text.split(/\r?\n/).map(cleanLine).filter((line) => line.length >= 2);
  const joined = lines.join("\n");
  const setMatch = joined.match(YUGIOH_SET_NUMBER_RE);
  const setCode = setMatch ? `${setMatch[1].toUpperCase()}-${setMatch[2].toUpperCase()}` : "";
  const cardNumber = setMatch ? setMatch[3].toUpperCase() : (joined.match(SIMPLE_NUMBER_RE)?.[1]?.toUpperCase() || "");
  const cardName = lines.find((line) => {
    const lower = line.toLowerCase();
    if (YUGIOH_SET_NUMBER_RE.test(line)) return false;
    if (/^(atk|def|level|rank|link|pendulum|spell|trap)\b/i.test(line)) return false;
    if (/\d{3,}/.test(line) && line.length < 12) return false;
    if (lower.includes("konami") || lower.includes("yugioh") || lower.includes("yu-gi-oh")) return false;
    return /[a-z]/i.test(line) && cleanCardName(line).length >= 3;
  }) || "Unknown Card";
  const cardSet = lines.find((line) => /\b(set|pack|deck|tin|collection|booster|legend|duelist|maze|metal|raiders|invasion|phantom|dark|crisis|battle)\b/i.test(line)) || "";
  let confidence = 55;
  if (cardName !== "Unknown Card") confidence += 20;
  if (setCode) confidence += 15;
  if (cardNumber) confidence += 10;
  return { cardName, cardSet: cardSet.replace(/^set[:\s-]*/i, "").trim(), cardNumber, setCode, confidence: Math.min(confidence, 98), rawText: text };
}

function numberCandidates(cardNumber?: string | null, setCode?: string | null): string[] {
  const raw = String(cardNumber || "").trim().toUpperCase();
  const code = String(setCode || "").trim().toUpperCase();
  const out = new Set<string>();
  if (raw) {
    out.add(raw);
    out.add(raw.replace(/^0+/, "") || raw);
    if (/^\d+$/.test(raw)) out.add(raw.padStart(3, "0"));
  }
  if (code && raw) {
    out.add(`${code}-${raw}`);
    out.add(`${code} ${raw}`);
    out.add(`${code.replace(/-[A-Z]{2}$/i, "")}-${raw}`);
  }
  return Array.from(out).filter(Boolean);
}

function setCodeCandidates(setCode?: string | null, rawText?: string | null): string[] {
  const out = new Set<string>();
  const add = (value?: string | null) => {
    const clean = String(value || "").trim().toUpperCase();
    if (!clean) return;
    out.add(clean);
    out.add(clean.replace(/-[A-Z]{2}$/i, ""));
  };
  add(setCode);
  const match = String(rawText || "").match(YUGIOH_SET_NUMBER_RE);
  if (match) add(`${match[1]}-${match[2]}`);
  return Array.from(out).filter(Boolean);
}

function scoreNameMatch(needle: string, haystack: string): number {
  const a = cleanCardName(needle);
  const b = cleanCardName(haystack);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 88;
  const aw = new Set(a.split(" ").filter((w) => w.length > 2));
  const bw = new Set(b.split(" ").filter((w) => w.length > 2));
  if (!aw.size || !bw.size) return 0;
  let hit = 0;
  aw.forEach((w) => { if (bw.has(w)) hit += 1; });
  return Math.round((hit / Math.max(aw.size, bw.size)) * 82);
}

function toMatch(row: any, confidence: number): PriceChartingCardMatch {
  const set = Array.isArray(row.pc_sets) ? row.pc_sets[0] : row.pc_sets;
  const raw = row.ungraded_price ?? null;
  return {
    cardName: row.card_name,
    cardSet: set?.set_name ?? null,
    cardNumber: row.card_number ?? null,
    rarity: row.rarity ?? null,
    currentPriceRaw: raw,
    currentPricePsa9: row.grade9_price ?? row.graded_price ?? null,
    currentPricePsa10: row.psa10_price ?? null,
    suggestedPrice: raw,
    priceChartingUrl: row.card_url ?? set?.source_url ?? null,
    confidence,
    source: "pricecharting-local",
  };
}

export async function findPriceChartingYuGiOhMatch(args: {
  cardName?: string | null;
  cardSet?: string | null;
  cardNumber?: string | null;
  setCode?: string | null;
  rawText?: string | null;
}): Promise<PriceChartingCardMatch | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return null;

  const parsed = parseYugiohOcrText(args.rawText || "");
  const cardName = args.cardName || parsed.cardName;
  const cardNumber = args.cardNumber || parsed.cardNumber;
  const setCode = args.setCode || parsed.setCode;
  const setCodes = setCodeCandidates(setCode, args.rawText);
  const numbers = numberCandidates(cardNumber, setCode);

  if (numbers.length) {
    let exact = supabase
      .from("pc_cards")
      .select("*, pc_sets!inner(set_name,set_code,source_url,game)")
      .eq("user_id", userId)
      .eq("pc_sets.game", "yugioh")
      .in("card_number", numbers)
      .limit(20);
    if (setCodes.length) exact = exact.in("pc_sets.set_code", setCodes);
    const { data } = await exact;
    if (data?.length) {
      const ranked = [...data].sort((a: any, b: any) => scoreNameMatch(cardName || "", b.card_name) - scoreNameMatch(cardName || "", a.card_name));
      return toMatch(ranked[0], setCodes.length ? 96 : 90);
    }
  }

  const clean = cleanCardName(cardName);
  if (clean.length >= 3) {
    const search = clean.split(" ").filter((w) => w.length > 2).slice(0, 4).join("%");
    const { data } = await supabase
      .from("pc_cards")
      .select("*, pc_sets!inner(set_name,set_code,source_url,game)")
      .eq("user_id", userId)
      .eq("pc_sets.game", "yugioh")
      .ilike("card_name_clean", `%${search}%`)
      .limit(20);
    if (data?.length) {
      const ranked = [...data]
        .map((row: any) => ({ row, score: scoreNameMatch(cardName || "", row.card_name) }))
        .filter((x) => x.score >= 45)
        .sort((a, b) => b.score - a.score);
      if (ranked.length) return toMatch(ranked[0].row, Math.max(65, ranked[0].score));
    }
  }
  return null;
}
