// src/hooks/use-card-verification.ts
// Hook wrapping verifyCard() with loading/error/result state.

import { useCallback, useState } from "react";
import { verifyCard, type VerifyCardInput, type VerifyCardResult } from "@/lib/verification/verifyCard";

export interface UseCardVerificationResult {
  result: VerifyCardResult | null;
  loading: boolean;
  error: string | null;
  run: (card: VerifyCardInput, force?: boolean) => Promise<VerifyCardResult | null>;
  reset: () => void;
}

export function useCardVerification(): UseCardVerificationResult {
  const [result, setResult] = useState<VerifyCardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (card: VerifyCardInput, force = false) => {
    setLoading(true);
    setError(null);
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

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  return { result, loading, error, run, reset };
}
