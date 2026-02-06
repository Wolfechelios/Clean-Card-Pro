// 10s timeout guard to prevent queue blocking
const LOCAL_LLM_TIMEOUT_MS = 10000;

export async function callLocalLLM(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_LLM_TIMEOUT_MS);

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral:7b",
        prompt,
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error("Local LLM failed");

    const data = await response.json();
    return data.response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Vision-capable local LLM for card identification (uses llava or bakllava)
export async function callLocalVisionLLM(imageUrl: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_LLM_TIMEOUT_MS * 3); // 30s for vision

  try {
    // Fetch image and convert to base64
    const imageResponse = await fetch(imageUrl);
    const imageBlob = await imageResponse.blob();
    const base64 = await blobToBase64(imageBlob);

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llava:7b", // Vision-capable model
        prompt,
        images: [base64.split(",")[1]], // Remove data:image/... prefix
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error("Local Vision LLM failed");

    const data = await response.json();
    return data.response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
