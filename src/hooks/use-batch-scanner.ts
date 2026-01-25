// src/hooks/use-batch-scanner.ts

export function useBatchScanner(scanMode: "RAPID" | "BATCH") {
  if (scanMode === "RAPID") {
    return {
      process: async () => {
        throw new Error("Batch scanning is disabled in RAPID mode");
      },
    };
  }

  return {
    process: async () => {
      // Batch logic allowed ONLY outside rapid scan
    },
  };
}
