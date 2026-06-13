import { analyzeCardFull } from "@/lib/analyzeCardFull";
import { fetchCardPrices, type CardPricing } from "@/lib/fetchCardPrices";
import { hybridIdentifyCard, type IdentifiedCardData } from "@/lib/hybridCardIdentify";
import { runPaddleOCR } from "@/lib/paddleOCR";
import { withRetry } from "@/lib/retry";
import { decideLearningQuestion, findLearnedIdentity, type LearningDecision } from "@/lib/activeLearning";

export interface ResolvedOcr {
  rawText: string;
  confidence: number;
  cardNameHint: string;
  cardSetHint: string;
  cardNumberHint: string;
  source: "local" | "cloud-fallback";
}

export interface ResolvedCardScan {
  identity: IdentifiedCardData;
  originalPrediction: IdentifiedCardData;
  ocr: ResolvedOcr;
  pricing: CardPricing | null;
  identityResolved: boolean;
  autoConfirmAllowed: boolean;
  source: "local" | "cloud" | "learned";
  learningDecision: LearningDecision;
}

const clampConfidence = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function parseOcrHints(rawText: string) {
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  const cardNumber = lines.find((line) => /(?:[A-Z]{1,5}-?\d{1,4}|\d{1,4}\/\d{1,4})/i.test(line)) || "";
  const cardSet = lines.find((line) => /(?:set|series|edition|expansion)/i.test(line)) || "";
  const cardName = lines
    .filter((line) => line !== cardNumber && line !== cardSet)
    .find((line) => /[A-Za-z]{3}/.test(line) && line.length <= 80) || "Unknown Card";
  return {
    cardName,
    cardSet: cardSet.replace(/(?:set|series|edition|expansion)\s*:?/i, "").trim(),
    cardNumber,
  };
}

async function runOcr(imageUrl: string): Promise<ResolvedOcr> {
  try {
    const local = await runPaddleOCR(imageUrl);
    const scores = local.lines.map((line) => Number(line.confidence || 0));
    const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
    const hints = parseOcrHints(local.text || "");
    return {
      rawText: local.text || "",
      confidence: clampConfidence(average <= 1 ? average * 100 : average),
      cardNameHint: hints.cardName,
      cardSetHint: hints.cardSet,
      cardNumberHint: hints.cardNumber,
      source: "local",
    };
  } catch (error) {
    console.warn("[ScanResolution] Local OCR unavailable; using cloud fallback", error);
    const analysis = await analyzeCardFull(imageUrl);
    const rawText = analysis.vision.ocr_text || "";
    const hints = parseOcrHints(rawText);
    return {
      rawText,
      confidence: analysis.card_name || analysis.card_details?.card_name ? 75 : 45,
      cardNameHint: hints.cardName,
      cardSetHint: hints.cardSet,
      cardNumberHint: hints.cardNumber,
      source: "cloud-fallback",
    };
  }
}

export async function resolveCardScan(imageUrl: string, options: { gameTypeHint?: string; condition?: string } = {}): Promise<ResolvedCardScan> {
  const ocr = await runOcr(imageUrl);
  let identified;
  try {
    identified = await withRetry(
      () => hybridIdentifyCard(imageUrl, {
        forceLocal: true,
        usePaddleOCR: false,
        ocrText: ocr.rawText,
        gameTypeHint: options.gameTypeHint,
      }),
      { retries: 1, baseMs: 700, maxMs: 4000 },
    );
  } catch {
    identified = await withRetry(
      () => hybridIdentifyCard(imageUrl, {
        forceCloud: true,
        usePaddleOCR: false,
        ocrText: ocr.rawText,
        gameTypeHint: options.gameTypeHint,
      }),
      { retries: 1, baseMs: 700, maxMs: 4000 },
    );
  }

  const originalPrediction: IdentifiedCardData = {
    ...identified.cardData,
    card_name: identified.cardData.card_name || ocr.cardNameHint,
    card_set: identified.cardData.card_set || ocr.cardSetHint || null,
    card_number: identified.cardData.card_number || ocr.cardNumberHint || null,
    confidence: clampConfidence(Number(identified.cardData.confidence || ocr.confidence)),
  };

  const learned = findLearnedIdentity(ocr.rawText);
  const identity: IdentifiedCardData = learned || originalPrediction;
  const source: ResolvedCardScan["source"] = learned ? "learned" : identified.source;
  const identityResolved = identity.card_name !== "Unknown Card" && identity.confidence >= 70 && Boolean(identity.card_number || identity.card_set);
  const learningDecision = decideLearningQuestion(identity);

  let pricing: CardPricing | null = null;
  if (identityResolved) {
    pricing = await withRetry(
      () => fetchCardPrices(identity.card_name, identity.card_set, identity.card_number, identity.game_type, identity.sport_type, options.condition || "ungraded"),
      { retries: 2, baseMs: 700, maxMs: 5000 },
    ).catch((error) => {
      console.warn("[ScanResolution] Pricing unavailable", error);
      return null;
    });
  }

  return {
    identity,
    originalPrediction,
    ocr,
    pricing,
    identityResolved,
    autoConfirmAllowed: identityResolved && identity.confidence >= 90 && !learningDecision.shouldAsk,
    source,
    learningDecision,
  };
}
