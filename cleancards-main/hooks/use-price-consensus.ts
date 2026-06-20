// src/hooks/use-price-consensus.ts
// React hook for fetching and managing price consensus state

import { useState, useCallback } from "react";
import type { PriceConsensus, CardPriceIdentity } from "@/lib/pricing/types";
import { verifyCardPrice, requiresManualReview } from "@/lib/pricing/priceVerification";

export interface UsePriceConsensusResult {
  consensus: PriceConsensus | null;
  loading: boolean;
  error: string | null;
  needsReview: boolean;
  fetchConsensus: (card: CardPriceIdentity) => Promise<void>;
  reset: () => void;
}

export function usePriceConsensus(): UsePriceConsensusResult {
  const [consensus, setConsensus] = useState<PriceConsensus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConsensus = useCallback(async (card: CardPriceIdentity) => {
    setLoading(true);
    setError(null);
    try {
      const result = await verifyCardPrice(card);
      setConsensus(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify price");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setConsensus(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    consensus,
    loading,
    error,
    needsReview: consensus ? requiresManualReview(consensus) : false,
    fetchConsensus,
    reset,
  };
}
