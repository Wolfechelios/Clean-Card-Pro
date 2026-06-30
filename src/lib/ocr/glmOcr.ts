import { extractPrintedCode, normalizeSetCodeToken, type DetectedGame } from "./gameCodePatterns";

export type GlmOcrResult = {
  rawText: string;
  title?: string;
  setCode?: string;
  cardNumber?: string;
  fullCode?: string;
  game?: DetectedGame;
  edition?: string;
  confidence: number;
  source: "local-glm-ocr";
};

const OLLAMA_URL = "http://localhost:11434/api/generate";
const DEFAULT_GLM_MODEL = "glm-ocr:latest";

function cleanLine(line: string): string {
  return line.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function extractTitle(text: string, codeRaw: string | null): string | undefined {
  const junk = /^(limited edition|1st edition|edition|common|rare|secret rare|ultra rare|super rare|effect|spell|trap|monster|password|konami|yugioh|yu-?gi-?oh|pokemon|pokémon|trainer|energy|hp\s*\d+|atk|def|illus\.|©|set code|card code|title|name)/i;
  const lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length >= 3 && line.length <= 80)
    .filter((line) => !junk.test(line))
    .filter((line) => !codeRaw || !line.toUpperCase().includes(codeRaw.toUpperCase()))
    .filter((line) => !/^\d+\s*\/\s*\d+$/.test(line));

  return lines.find((line) => /[A-Za-z]/.test(line) && !/[.!?]{2,}/.test(line));
}

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image for GLM OCR"));
    reader.readAsDataURL(blob);
  });
}

function parseResponseText(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    return [parsed.setCode, parsed.cardCode, parsed.cardName, parsed.title, parsed.rawText, parsed.text]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    return text;
  }
}

function finalize(rawText: string): GlmOcrResult {
  const detected = extractPrintedCode(rawText);
  const normalizedSet = detected.setCode && detected.cardNumber
    ? normalizeSetCodeToken(`${detected.setCode}-${detected.cardNumber}`)
    : null;

  const title = extractTitle(rawText, detected.rawMatch);

  return {
    rawText,
    title,
    setCode: normalizedSet ?? detected.fullCode ?? undefined,
    cardNumber: detected.cardNumber ?? undefined,
    fullCode: detected.fullCode ?? undefined,
    game: detected.game,
    edition: detected.edition ?? undefined,
    confidence: Math.max(0.85, detected.confidence || 0),
    source: "local-glm-ocr",
  };
}

export async function runGlmOcr(image: Blob | File | string, model = DEFAULT_GLM_MODEL): Promise<GlmOcrResult | null> {
  try {
    const imageDataUrl = typeof image === "string" ? image : await blobToDataUrl(image);
    const imageBase64 = dataUrlToBase64(imageDataUrl);

    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        prompt: [
          "You are OCR for trading cards.",
          "Read the card image and return only the visible text needed to identify the exact printing.",
          "Prioritize the printed set/card code such as LOB-001, SDK-001, SDY-046, RA01-EN001, MP25-EN318.",
          "Also include the card title if visible.",
          "Do not guess. If unreadable, return the text you can see."
        ].join("\n"),
        images: [imageBase64],
        options: {
          temperature: 0,
          num_predict: 160,
        },
      }),
    });

    if (!response.ok) {
      console.warn("[glmOcr] Ollama GLM OCR failed:", response.status, await response.text().catch(() => ""));
      return null;
    }

    const json = await response.json();
    const rawText = parseResponseText(json?.response);
    if (!rawText) return null;

    return finalize(rawText);
  } catch (error) {
    console.warn("[glmOcr] Local GLM OCR unavailable:", error);
    return null;
  }
}
