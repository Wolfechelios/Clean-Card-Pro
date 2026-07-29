// src/lib/ocr/localCardOcr.ts
// Local/browser OCR for Rapid Scan. Uses existing PaddleOCR dependency, no identify AI.

import { runPaddleOCR } from "@/lib/paddleOCR";
import { extractPrintedCode, type DetectedGame } from "./gameCodePatterns";

export type LocalCardOcrResult = {
  rawText: string;
  title?: string;
  setCode?: string;
  cardNumber?: string;
  fullCode?: string;
  game?: DetectedGame;
  edition?: string;
  confidence: number;
  source: "local-browser-ocr";
};

function cleanLine(line: string): string {
  // OCR output can contain C0 controls that must not become card-name text.
  // eslint-disable-next-line no-control-regex
  return line.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function extractTitle(text: string, codeRaw: string | null): string | undefined {
  const junk = /^(limited edition|1st edition|edition|common|rare|secret rare|ultra rare|super rare|effect|spell|trap|monster|password|konami|yugioh|yu-?gi-?oh|pokemon|pokémon|trainer|energy|hp\s*\d+|atk|def|illus\.|©)/i;
  const lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length >= 3 && line.length <= 80)
    .filter((line) => !junk.test(line))
    .filter((line) => !codeRaw || !line.toUpperCase().includes(codeRaw.toUpperCase()))
    .filter((line) => !/^\d+\s*\/\s*\d+$/.test(line));
  return lines.find((line) => /[A-Za-z]/.test(line) && !/[.!?]{2,}/.test(line));
}

export async function runLocalCardOcr(image: Blob | File | string): Promise<LocalCardOcrResult> {
  const result = await runPaddleOCR(image);
  const rawText = result.text || "";
  const detected = extractPrintedCode(rawText);
  const bestLineConfidence = Math.max(0, ...result.lines.map((line) => Number(line.confidence) || 0));

  return {
    rawText,
    title: extractTitle(rawText, detected.rawMatch),
    setCode: detected.fullCode ?? detected.setCode ?? undefined,
    cardNumber: detected.cardNumber ?? undefined,
    fullCode: detected.fullCode ?? undefined,
    game: detected.game,
    edition: detected.edition ?? undefined,
    confidence: Math.max(bestLineConfidence, detected.confidence),
    source: "local-browser-ocr",
  };
}
