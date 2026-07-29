import {
  findYugiohSetCodeIndexMatch,
  normalizeYugiohPrintedCode,
} from "@/lib/yugiohSetCodeIndex";

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

const YUGIOH_PRINTED_CODE_RE = /\b([A-Z0-9]{2,12})(?:[-\s]?([A-Z]{2}))?[-\s]?(\d{2,5}[A-Z]?)\b/i;
const SIMPLE_NUMBER_RE = /(?:#|no\.?|number)?\s*\b(\d{1,5}[A-Z]?)\b/i;
const NOISE_WORDS = /\b(1st|edition|limited|unlimited|konami|yugioh|yu-gi-oh|trading|card|game|spell|trap|effect|monster|warrior|dragon|machine|aqua|beast|fiend|fairy|zombie|pyro|rock|winged|divine|normal|quick-play|continuous|counter|field|equip|atk|def|level|rank|link)\b/gi;

export function cleanCardName(value: string | null | undefined): string {
  return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(NOISE_WORDS, " ").replace(/\s+/g, " ").trim();
}

function cleanLine(line: string): string {
  return line.replace(/^[^a-z0-9]+/i, "").replace(/\s+/g, " ").trim();
}

export function parseYugiohOcrText(rawText: string | null | undefined): ParsedCardOcr {
  const text = String(rawText || "");
  const lines = text.split(/\r?\n/).map(cleanLine).filter((line) => line.length >= 2);
  const joined = lines.join("\n");
  const setMatch = joined.match(YUGIOH_PRINTED_CODE_RE);
  const setCode = setMatch
    ? normalizeYugiohPrintedCode(setMatch[0]) ?? ""
    : "";
  const normalizedNumber =
    setCode.match(
      /-(?:(?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE))?(\d{2,5}[A-Z]?)$/,
    )?.[1] ?? "";
  const cardNumber = setMatch
    ? normalizedNumber
    : (joined.match(SIMPLE_NUMBER_RE)?.[1]?.toUpperCase() || "");
  const cardName = lines.find((line) => {
    const lower = line.toLowerCase();
    if (YUGIOH_PRINTED_CODE_RE.test(line)) return false;
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

export async function findPriceChartingYuGiOhMatch(args: { cardName?: string | null; cardSet?: string | null; cardNumber?: string | null; setCode?: string | null; rawText?: string | null }): Promise<PriceChartingCardMatch | null> {
  const parsed = parseYugiohOcrText(args.rawText || "");
  const match = await findYugiohSetCodeIndexMatch({
    cardName: args.cardName || parsed.cardName,
    cardSet: args.cardSet || parsed.cardSet,
    cardNumber: args.cardNumber || parsed.cardNumber,
    setCode: args.setCode || parsed.setCode,
    rawText: args.rawText || parsed.rawText,
  });
  if (!match) return null;
  return { cardName: match.cardName, cardSet: match.cardSet, cardNumber: match.cardNumber, rarity: match.rarity, currentPriceRaw: match.currentPriceRaw, currentPricePsa9: match.currentPricePsa9, currentPricePsa10: match.currentPricePsa10, suggestedPrice: match.suggestedPrice, priceChartingUrl: match.priceChartingUrl, confidence: match.confidence, source: "pricecharting-local" };
}
