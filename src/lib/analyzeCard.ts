import { callLocalLLM } from "./localLLM";
import { callCloudLLM } from "./cloudLLM";
import { isLocalLLMAvailable, isOnline } from "./inferenceMode";

export async function analyzeCard(prompt: string) {

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
    } catch {
      // fallback to local if cloud fails
      if (localAvailable) {
        return await callLocalLLM(prompt);
      }
      throw new Error("Both cloud and local failed");
    }
  }

  // Final fallback
  if (localAvailable) {
    return await callLocalLLM(prompt);
  }

  throw new Error("No inference engine available");
}
