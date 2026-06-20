import * as webllm from "@mlc-ai/web-llm";

let engine: webllm.MLCEngine | null = null;

export async function initLocalLLM() {
  if (engine) return engine;

  engine = await webllm.CreateMLCEngine(
    "Llama-3-8B-Instruct-q4f16_1",
    { initProgressCallback: console.log }
  );

  return engine;
}

export async function runLocalPrompt(prompt: string) {
  const llm = await initLocalLLM();

  const reply = await llm.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
  });

  return reply.choices[0].message.content;
}
