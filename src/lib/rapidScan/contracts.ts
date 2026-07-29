export type CaptureMode = "auto" | "manual";
export type CaptureProfileId =
  | "standard"
  | "sleeved"
  | "foil"
  | "chrome-prizm"
  | "absolute-high-gloss"
  | "custom";

export type CaptureJobStatus =
  | "captured"
  | "processing_ocr"
  | "identified"
  | "saved"
  | "needs_review"
  | "identification_error";

export type RapidScanSession = {
  id: string;
  game: "yugioh" | "pokemon" | "mtg" | "sports" | "other";
  selectedSetId: string | null;
  selectedSetName: string | null;
  profileId: CaptureProfileId;
  captureMode: CaptureMode;
};

export type CaptureJob = {
  id: string;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
  rotation: 0 | 90 | 180 | 270;
  status: CaptureJobStatus;
  processingStartedAt?: number;
  retryCount: number;
  error?: string;
  session: RapidScanSession;
  originalBlob: Blob;
  libraryBlob?: Blob;
  ocrBlob?: Blob;
  mime: string;
};

export type ResolvedCardIdentity = {
  game: RapidScanSession["game"];
  cardName: string;
  printedCode: string | null;
  setId: string | null;
  setName: string | null;
  language: string | null;
  edition: string | null;
  variant: string | null;
  confidence: number;
};

export type ResolveResult =
  | {
      status: "identified";
      identity: ResolvedCardIdentity;
      selectedSetCorrected: boolean;
      evidence: string[];
    }
  | { status: "needs_review"; candidates: ResolvedCardIdentity[]; reason: string }
  | { status: "identification_error"; reason: string };

export type InventoryUpsertResult = {
  inventoryId: string;
  quantity: number;
  action: "created" | "incremented";
};

const TRANSITIONS: Record<CaptureJobStatus, readonly CaptureJobStatus[]> = {
  captured: ["processing_ocr"],
  processing_ocr: ["identified", "needs_review", "identification_error"],
  identified: ["saved", "needs_review", "identification_error"],
  saved: [],
  needs_review: ["identified", "captured"],
  identification_error: ["captured"],
};

export function canTransitionCaptureJob(from: CaptureJobStatus, to: CaptureJobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
