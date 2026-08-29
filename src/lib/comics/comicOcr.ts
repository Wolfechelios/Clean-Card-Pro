// Comic cover OCR → structured fields. Free / on-device only (PaddleOCR).
// A comic cover's strongest identifiers are the logo title, the issue number
// and the cover date, so we read the text and parse those three first.

import { runPaddleOCR } from "@/lib/paddleOCR";

export type ComicOcrResult = {
  rawText: string;
  title?: string;
  issueNumber?: string;
  year?: number;
  publisher?: string;
  confidence: number;
};

const PUBLISHERS: Array<[RegExp, string]> = [
  [/\bmarvel\b/i, "Marvel"],
  [/\bdc\s*comics\b|\bdc\b/i, "DC"],
  [/\bimage\s*comics\b/i, "Image"],
  [/\bdark\s*horse\b/i, "Dark Horse"],
  [/\bidw\b/i, "IDW"],
  [/\bboom!?\s*studios\b/i, "BOOM! Studios"],
  [/\bvaliant\b/i, "Valiant"],
  [/\barchie\b/i, "Archie"],
  [/\bdynamite\b/i, "Dynamite"],
];

const NOISE =
  /^(no\.?|issue|approved by|the comics code authority|comics code|all new|all-new|now|feature|story|©|copyright|\$?\d+(\.\d{2})?¢?)$/i;

function clean(line: string): string {
  return line.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

export function parseComicIssue(text: string): string | undefined {
  const explicit = text.match(/\b(?:no\.?|issue|#)\s*(\d{1,4}(?:\.\d)?)\b/i);
  if (explicit) return explicit[1].replace(/^0+(?=\d)/, "");
  const hashless = text.match(/(?:^|\n)\s*#?\s*(\d{1,4})\s*(?:$|\n)/);
  return hashless ? hashless[1].replace(/^0+(?=\d)/, "") : undefined;
}

export function parseComicYear(text: string): number | undefined {
  const matches = text.match(/\b(19[3-9]\d|20[0-4]\d)\b/g);
  if (!matches?.length) return undefined;
  const years = matches.map(Number).filter((y) => y >= 1935 && y <= new Date().getFullYear() + 1);
  return years.length ? Math.max(...years) : undefined;
}

export function parseComicPublisher(text: string): string | undefined {
  for (const [pattern, name] of PUBLISHERS) {
    if (pattern.test(text)) return name;
  }
  return undefined;
}

export function parseComicTitle(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line.length >= 3 && line.length <= 60)
    .filter((line) => !NOISE.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => /[A-Za-z]{3,}/.test(line))
    .filter((line) => !PUBLISHERS.some(([pattern]) => pattern.test(line) && line.length < 14));

  // Comic logos are the biggest text, which OCR usually returns first, and they
  // tend to be mostly uppercase.
  const shouty = lines.find((line) => line === line.toUpperCase() && line.length >= 4);
  return shouty ?? lines[0];
}

export function parseComicOcrText(rawText: string): Omit<ComicOcrResult, "confidence"> {
  return {
    rawText,
    title: parseComicTitle(rawText),
    issueNumber: parseComicIssue(rawText),
    year: parseComicYear(rawText),
    publisher: parseComicPublisher(rawText),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Failed to read cover image"));
    reader.readAsDataURL(blob);
  });
}

export async function runComicCoverOcr(image: Blob | File | string): Promise<ComicOcrResult> {
  const source = typeof image === "string" ? image : await blobToDataUrl(image);
  const result = await runPaddleOCR(source);
  const rawText = result.text || "";
  const bestLine = Math.max(0, ...result.lines.map((line) => Number(line.confidence) || 0));
  return { ...parseComicOcrText(rawText), confidence: bestLine };
}
