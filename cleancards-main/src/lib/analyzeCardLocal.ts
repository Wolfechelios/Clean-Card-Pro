import { runLocalPrompt } from "./browserLLM";

export async function analyzeCard(prompt: string) {
  return await runLocalPrompt(prompt);
}
