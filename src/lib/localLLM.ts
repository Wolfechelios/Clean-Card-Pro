export async function callLocalLLM(prompt: string) {
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mistral:7b",
      prompt,
      stream: false
    })
  });

  if (!response.ok) throw new Error("Local LLM failed");

  const data = await response.json();
  return data.response;
}
