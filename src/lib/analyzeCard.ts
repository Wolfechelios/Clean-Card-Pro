// src/lib/analyzeCard.ts
// Unified routing layer for text-based LLM analysis
// For card identification from images, use hybridCardIdentify.ts instead

import { callLocalLLM } from "./localLLM";
import { callCloudLLM } from "./cloudLLM";
import { isLocalLLMAvailable, isOnline } from "./inferenceMode";

export async function analyzeCard(prompt: string): Promise<string> {
  const localAvailable = await isLocalLLMAvailable();
  const online = isOnline();

  // Priority 1: If offline but local exists → use local
  if (!online && localAvailable) {
    return await callLocalLLM(prompt);
  }

  // Priority 2: If online and cloud exists → use cloud
  if (online) {
    try {
      return await callCloudLLM(prompt);
    } catch (cloudError) {
      // fallback to local if cloud fails
      if (localAvailable) {
        console.warn("Cloud LLM failed, falling back to local:", cloudError);
        return await callLocalLLM(prompt);
      }
      throw new Error(`Cloud LLM failed and no local fallback available: ${cloudError instanceof Error ? cloudError.message : String(cloudError)}`);
    }
  }

  // Final fallback
  if (localAvailable) {
    return await callLocalLLM(prompt);
  }

  throw new Error("No inference engine available: offline and no local LLM running");
}
