// src/hooks/use-card-scanner.ts

import { useCallback } from "react";

export interface ScanResult {
  text: string;
  confidence: number;
}

export function useCardScanner() {
  const processScan = useCallback(async (image: ImageBitmap): Promise<ScanResult | null> => {
    // IMPORTANT:
    // This function MUST handle exactly ONE image at a time.
    // No retries. No batching. No queues.

    try {
      // Call OCR / recognition here
      // Example placeholder:
      const result = await fakeOCR(image);

      if (!result || result.confidence < 0.6) return null;

      return result;
    } catch {
      return null;
    }
  }, []);

  return { processScan };
}

// Placeholder – replace with real OCR
async function fakeOCR(_: ImageBitmap): Promise<ScanResult | null> {
  return null;
}
