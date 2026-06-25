import { createWorker, type Worker } from "tesseract.js";

export type LocalCardOcrResult = {
  rawText: string;
  title?: string;
  setCode?: string;
  cardNumber?: string;
  confidence: number;
  source: "local-browser-ocr";
};

const SET_CODE_PATTERNS = [
  /\b[A-Z]{2,6}[-\s]?[A-Z]{1,5}[-\s]?\d{1,4}\b/i,
  /\b[A-Z]{2,6}[-\s]?\d{1,4}\b/i,
];

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

function cleanLine(line: string): string {
  return line
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSetCode(text: string): string | undefined {
  const normalized = text.toUpperCase().replace(/[–—]/g, "-");
  for (const pattern of SET_CODE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[0]) {
      return match[0].replace(/\s+/g, "-").replace(/--+/g, "-");
    }
  }
  return undefined;
}

function extractCardNumber(text: string): string | undefined {
  const normalized = text.toUpperCase();
  return (
    normalized.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/)?.[0]?.replace(/\s+/g, "") ||
    normalized.match(/\b[A-Z]{1,5}[-\s]?\d{1,4}\b/)?.[0]?.replace(/\s+/g, "")
  );
}

function extractTitle(text: string): string | undefined {
  const junk = /^(limited edition|1st edition|edition|common|rare|secret rare|ultra rare|super rare|effect|spell|trap|monster|dragon|warrior|machine|caster|attribute|level|atk|def|password|konami|yugioh|yu-gi-oh)$/i;
  const lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length >= 3 && line.length <= 80)
    .filter((line) => !junk.test(line))
    .filter((line) => !SET_CODE_PATTERNS.some((pattern) => pattern.test(line)))
    .filter((line) => !/^\d+[\/]\d+$/.test(line));

  const likelyTitle = lines.find((line) => /[A-Za-z]/.test(line) && !/[.!?]{2,}/.test(line));
  return likelyTitle;
}

export async function runLocalCardOcr(image: Blob | File | string): Promise<LocalCardOcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  const rawText = data.text || "";
  const confidence = Math.max(0, Math.min(1, Number(data.confidence || 0) / 100));

  return {
    rawText,
    title: extractTitle(rawText),
    setCode: extractSetCode(rawText),
    cardNumber: extractCardNumber(rawText),
    confidence,
    source: "local-browser-ocr",
  };
}

export async function shutdownLocalCardOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}
