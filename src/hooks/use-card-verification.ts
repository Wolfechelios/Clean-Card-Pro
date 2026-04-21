// src/hooks/use-card-verification.ts
// Hook wrapping verifyCard() + priceCandidate() with selected-candidate state.

import { useCallback, useState } from "react";
import {
  verifyCard,
  priceCandidate,
  type VerifyCardInput,
  type VerifyCardResult,
  type VerifiedCandidate,
} from "@/lib/verification/verifyCard";

export interface UseCardVerificationResult {
  result: VerifyCardResult | null;
  /** Currently selected candidate (defaults to primary). */
  selected: VerifiedCandidate | null;
  /** Index of the selected candidate within result.candidates. */
  selectedIndex: number;
  loading: boolean;
  /** True when re-pricing a newly selected candidate. */
  switching: boolean;
  error: string | null;
  run: (card: VerifyCardInput, force?: boolean) => Promise<VerifyCardResult | null>;
  selectCandidate: (index: number) => Promise<void>;
  reset: () => void;
}

export function useCardVerification(): UseCardVerificationResult {
  const [result, setResult] = useState<VerifyCardResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<VerifyCardInput | null>(null);

  const run = useCallback(async (card: VerifyCardInput, force = false) => {
    setLoading(true);
    setError(null);
    setLastInput(card);
    setSelectedIndex(0);
    try {
      const r = await verifyCard(card, force);
      setResult(r);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const selectCandidate = useCallback(
    async (index: number) => {
      if (!result || !result.candidates[index]) return;
      if (index === selectedIndex) return;

      const candidate = result.candidates[index];
      setSelectedIndex(index);
      setSwitching(true);
      try {
        const { consensus, referenceImageUrl, needsReview } = await priceCandidate(
          candidate,
          lastInput?.condition,
          false
        );
        setResult((prev) =>
          prev
            ? {
                ...prev,
                identification: candidate,
                consensus,
                referenceImageUrl,
                needsReview,
              }
            : prev
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to price candidate";
        setError(msg);
      } finally {
        setSwitching(false);
      }
    },
    [result, selectedIndex, lastInput]
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
    setSwitching(false);
    setSelectedIndex(0);
    setLastInput(null);
  }, []);

  const selected = result?.candidates[selectedIndex] ?? null;

  return { result, selected, selectedIndex, loading, switching, error, run, selectCandidate, reset };
}
