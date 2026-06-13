import type { IdentifiedCardData } from "@/lib/hybridCardIdentify";

const STORAGE_KEY = "clean-card-active-learning-v1";
const QUESTION_KEY = "clean-card-active-learning-question-state-v1";
const MAX_RECORDS = 5000;

export interface LearningRecord {
  id: string;
  createdAt: string;
  imageUrl?: string;
  ocrText: string;
  fingerprint: string;
  predicted: IdentifiedCardData;
  confirmed: IdentifiedCardData;
  corrected: boolean;
  confidenceBefore: number;
}

export interface LearningDecision {
  shouldAsk: boolean;
  reason: "low-confidence" | "close-candidates" | "periodic-check" | "none";
  question?: string;
}

const normalize = (value?: string | null) => (value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export function createScanFingerprint(ocrText: string): string {
  const normalized = normalize(ocrText).split(" ").filter(Boolean).slice(0, 40).join("|");
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function loadRecords(): LearningRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecords(records: LearningRecord[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
}

export function rememberVerifiedScan(input: {
  imageUrl?: string;
  ocrText: string;
  predicted: IdentifiedCardData;
  confirmed: IdentifiedCardData;
}): LearningRecord {
  const corrected = normalize(input.predicted.card_name) !== normalize(input.confirmed.card_name)
    || normalize(input.predicted.card_set) !== normalize(input.confirmed.card_set)
    || normalize(input.predicted.card_number) !== normalize(input.confirmed.card_number);
  const record: LearningRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    imageUrl: input.imageUrl,
    ocrText: input.ocrText,
    fingerprint: createScanFingerprint(input.ocrText),
    predicted: input.predicted,
    confirmed: input.confirmed,
    corrected,
    confidenceBefore: Number(input.predicted.confidence || 0),
  };
  const records = loadRecords();
  records.push(record);
  saveRecords(records);
  return record;
}

export function findLearnedIdentity(ocrText: string): IdentifiedCardData | null {
  const fingerprint = createScanFingerprint(ocrText);
  const records = loadRecords();
  const exact = [...records].reverse().find((record) => record.fingerprint === fingerprint);
  if (exact) return { ...exact.confirmed, confidence: Math.max(96, exact.confirmed.confidence || 0) };

  const tokens = new Set(normalize(ocrText).split(" ").filter(Boolean));
  let best: { record: LearningRecord; score: number } | null = null;
  for (const record of records) {
    const learned = new Set(normalize(record.ocrText).split(" ").filter(Boolean));
    if (!tokens.size || !learned.size) continue;
    let common = 0;
    for (const token of tokens) if (learned.has(token)) common += 1;
    const score = common / Math.max(tokens.size, learned.size);
    if (score >= 0.72 && (!best || score > best.score)) best = { record, score };
  }
  if (!best) return null;
  return { ...best.record.confirmed, confidence: Math.round(88 + best.score * 10) };
}

function questionState(): { scans: number; lastAsked: number } {
  if (typeof localStorage === "undefined") return { scans: 0, lastAsked: -20 };
  try {
    return JSON.parse(localStorage.getItem(QUESTION_KEY) || '{"scans":0,"lastAsked":-20}');
  } catch {
    return { scans: 0, lastAsked: -20 };
  }
}

export function decideLearningQuestion(identity: IdentifiedCardData, candidateGap?: number): LearningDecision {
  const state = questionState();
  state.scans += 1;
  const sinceLast = state.scans - state.lastAsked;
  let decision: LearningDecision = { shouldAsk: false, reason: "none" };

  if (identity.confidence < 75) {
    decision = { shouldAsk: true, reason: "low-confidence", question: "Please confirm the card name, set, and card number." };
  } else if (identity.confidence < 90 && candidateGap !== undefined && candidateGap < 8) {
    decision = { shouldAsk: true, reason: "close-candidates", question: "Two matches are close. Which card is correct?" };
  } else if (sinceLast >= 15 && identity.confidence < 96) {
    decision = { shouldAsk: true, reason: "periodic-check", question: "Is this identification correct?" };
  }

  if (decision.shouldAsk) state.lastAsked = state.scans;
  if (typeof localStorage !== "undefined") localStorage.setItem(QUESTION_KEY, JSON.stringify(state));
  return decision;
}

export function exportLearningRecords(): LearningRecord[] {
  return loadRecords();
}

export function removeLearningRecord(id: string) {
  saveRecords(loadRecords().filter((record) => record.id !== id));
}
