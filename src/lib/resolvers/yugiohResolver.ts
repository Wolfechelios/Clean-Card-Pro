import { parseYugiohOcrText } from "@/lib/cardOcrParser";
import { lookupYugiohByPrintedCode } from "@/lib/yugiohDirectLookup";
import { listBundledYugiohSets } from "@/lib/rapidScan/bundledYugiohSets";
import type {
  ResolvedCardIdentity,
  ResolveResult,
} from "@/lib/rapidScan/contracts";
import {
  findYugiohSetCodeIndexCandidates,
  makeYugiohSetId,
  normalizeYugiohPrintedCode,
} from "@/lib/yugiohSetCodeIndex";
import type { CardResolver, ResolveRequest } from "./contracts";

export type YugiohResolverCandidate = {
  printedCode: string | null;
  setId: string | null;
  setName?: string | null;
  cardName: string;
  language?: string | null;
  edition?: string | null;
  variant?: string | null;
  confidence?: number;
};

type ResolverPolicyInput = {
  printedCode?: string | null;
  selectedSetId?: string | null;
};

function setPrefix(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return null;
  return text.split("::", 1)[0].split("-", 1)[0] || null;
}

function isSelectedSet(
  candidate: YugiohResolverCandidate,
  selectedSetId: string | null | undefined,
): boolean {
  const selectedId = String(selectedSetId ?? "").trim();
  if (selectedId.includes("::")) {
    return (
      String(candidate.setId ?? "").toLowerCase() === selectedId.toLowerCase()
    );
  }
  const selected = setPrefix(selectedId);
  return Boolean(
    selected &&
      (setPrefix(candidate.setId) === selected ||
        setPrefix(candidate.printedCode) === selected),
  );
}

export function rankResolverCandidates(
  input: ResolverPolicyInput,
  candidates: readonly YugiohResolverCandidate[],
): {
  match: YugiohResolverCandidate | null;
  selectedSetCorrected: boolean;
  confidence: number;
} {
  const wantedCode = normalizeYugiohPrintedCode(input.printedCode);
  const exact = wantedCode
    ? candidates.find(
        (candidate) =>
          normalizeYugiohPrintedCode(candidate.printedCode) === wantedCode,
      )
    : undefined;

  if (exact) {
    return {
      match: exact,
      selectedSetCorrected: Boolean(
        input.selectedSetId && !isSelectedSet(exact, input.selectedSetId),
      ),
      confidence: 0.98,
    };
  }

  const selected = candidates.find((candidate) =>
    isSelectedSet(candidate, input.selectedSetId),
  );
  const match =
    selected ??
    [...candidates].sort(
      (left, right) => (right.confidence ?? 0) - (left.confidence ?? 0),
    )[0] ??
    null;

  return {
    match,
    selectedSetCorrected: false,
    confidence: match ? Math.min(match.confidence ?? 0.75, 0.92) : 0,
  };
}

function identityFromCandidate(
  candidate: YugiohResolverCandidate,
  confidence: number,
): ResolvedCardIdentity {
  return {
    game: "yugioh",
    cardName: candidate.cardName,
    printedCode: normalizeYugiohPrintedCode(candidate.printedCode),
    setId: candidate.setId,
    setName: candidate.setName ?? null,
    language: candidate.language ?? null,
    edition: candidate.edition ?? null,
    variant: candidate.variant ?? null,
    confidence,
  };
}

export async function listYugiohSets(): Promise<
  Array<{ id: string; name: string }>
> {
  return listBundledYugiohSets();
}

export const yugiohResolver: CardResolver = {
  game: "yugioh",
  listSets: listYugiohSets,

  async resolve({ session, ocr }: ResolveRequest): Promise<ResolveResult> {
    const parsed = parseYugiohOcrText(ocr.rawText);
    const printedCode = normalizeYugiohPrintedCode(
      ocr.fullCode ?? ocr.setCode ?? parsed.setCode,
    );

    const localMatches = await findYugiohSetCodeIndexCandidates({
      setCode: printedCode,
      cardNumber: ocr.cardNumber ?? parsed.cardNumber,
      cardName: ocr.title ?? parsed.cardName,
      cardSet: session.selectedSetName ?? parsed.cardSet,
      selectedSetId: session.selectedSetId,
      rawText: ocr.rawText,
    });

    const candidates: YugiohResolverCandidate[] = [];
    const exactLocalMatches = printedCode
      ? localMatches.filter(
          (match) =>
            normalizeYugiohPrintedCode(match.setCode) === printedCode,
        )
      : localMatches;
    for (const localMatch of exactLocalMatches) {
      candidates.push({
        printedCode: localMatch.setCode ?? printedCode,
        setId: localMatch.setId,
        setName: localMatch.cardSet,
        cardName: localMatch.cardName,
        edition: ocr.edition ?? null,
        variant: localMatch.rarity,
        confidence: localMatch.confidence / 100,
      });
    }

    if (!exactLocalMatches.length && printedCode) {
      const fallback = await lookupYugiohByPrintedCode(printedCode);
      if (fallback?.success && fallback.cardData?.card_name) {
        candidates.push({
          printedCode,
          setId: makeYugiohSetId(
            printedCode,
            fallback.cardData.card_set,
          ),
          setName: fallback.cardData.card_set,
          cardName: fallback.cardData.card_name,
          edition: ocr.edition ?? null,
          variant: fallback.cardData.rarity,
          confidence: fallback.cardData.confidence ?? 0.9,
        });
      }
    }

    const ranked = rankResolverCandidates(
      { printedCode, selectedSetId: session.selectedSetId },
      candidates,
    );
    if (!ranked.match) {
      return {
        status: "identification_error",
        reason: "No Yu-Gi-Oh identity matched the captured card.",
      };
    }

    return {
      status: "identified",
      identity: identityFromCandidate(ranked.match, ranked.confidence),
      selectedSetCorrected: ranked.selectedSetCorrected,
      evidence: [
        printedCode
          ? `exact-printed-code:${printedCode}`
          : "selected-set-and-ocr",
        exactLocalMatches.length
          ? "local-set-code-index"
          : "ygoprodeck-identity-fallback",
      ],
    };
  },
};
