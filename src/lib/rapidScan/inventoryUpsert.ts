import type {
  CaptureJob,
  InventoryUpsertResult,
  ResolveResult,
} from "./contracts";
import {
  rapidScanDb,
  type InventoryCard,
  type ScanEvent,
} from "./db";

type FingerprintInput = {
  game: string | null | undefined;
  language: string | null | undefined;
  printedCode: string | null | undefined;
  edition: string | null | undefined;
  variant: string | null | undefined;
  gradingCompany?: string | null;
  grade?: string | null;
};

type IdentifiedResult = Extract<ResolveResult, { status: "identified" }>;

export type InventoryCaptureImages = {
  libraryBlob?: Blob;
  imageUrl?: string | null;
  gradingCompany?: string | null;
  grade?: string | null;
};

const normalizeFingerprintComponent = (
  value: string | null | undefined,
): string => String(value ?? "").trim().toLowerCase();

const normalizeRawGradeComponent = (
  value: string | null | undefined,
): string => normalizeFingerprintComponent(value) || "ungraded";

export function buildCardFingerprintSource(input: FingerprintInput): string {
  return [
    normalizeFingerprintComponent(input.game),
    normalizeFingerprintComponent(input.language),
    normalizeFingerprintComponent(input.printedCode),
    normalizeFingerprintComponent(input.edition),
    normalizeFingerprintComponent(input.variant),
    normalizeRawGradeComponent(input.gradingCompany),
    normalizeRawGradeComponent(input.grade),
  ].join("\u001f");
}

export async function buildCardFingerprint(
  input: FingerprintInput,
): Promise<string> {
  const source = new TextEncoder().encode(buildCardFingerprintSource(input));
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function planInventoryMutation(
  existing: { quantity: number },
  reason: "new-capture" | "retry-existing-event",
): { nextQuantity: number } {
  return {
    nextQuantity: reason === "new-capture"
      ? existing.quantity + 1
      : existing.quantity,
  };
}

function resultFromEvent(event: ScanEvent): InventoryUpsertResult {
  return {
    inventoryId: event.inventoryId,
    quantity: event.libraryQuantity,
    action: event.quantityAction,
  };
}

export async function upsertIdentifiedCapture(
  job: CaptureJob,
  result: IdentifiedResult,
  images: InventoryCaptureImages = {},
): Promise<InventoryUpsertResult> {
  const fingerprintInput: FingerprintInput = {
    game: result.identity.game,
    language: result.identity.language,
    printedCode: result.identity.printedCode,
    edition: result.identity.edition,
    variant: result.identity.variant,
    gradingCompany: images.gradingCompany,
    grade: images.grade,
  };
  const fingerprintSource = buildCardFingerprintSource(fingerprintInput);
  const fingerprint = await buildCardFingerprint(fingerprintInput);

  return rapidScanDb.transaction(
    "rw",
    rapidScanDb.inventoryCards,
    rapidScanDb.scanEvents,
    rapidScanDb.captureJobs,
    async () => {
      const existingEvent = await rapidScanDb.scanEvents
        .where("idempotencyKey")
        .equals(job.idempotencyKey)
        .first();
      if (existingEvent) {
        const storedJob = await rapidScanDb.captureJobs.get(job.id);
        if (storedJob && storedJob.status !== "saved") {
          await rapidScanDb.captureJobs.put({
            ...storedJob,
            status: "saved",
            updatedAt: Date.now(),
            error: undefined,
          });
        }
        return resultFromEvent(existingEvent);
      }

      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const existingCard = await rapidScanDb.inventoryCards
        .where("fingerprint")
        .equals(fingerprint)
        .first();
      const quantityAction = existingCard ? "incremented" : "created";
      const inventoryId = existingCard?.id ?? crypto.randomUUID();
      const quantity = planInventoryMutation(
        { quantity: existingCard?.quantity ?? 0 },
        "new-capture",
      ).nextQuantity;
      const inventoryCard: InventoryCard = existingCard
        ? {
            ...existingCard,
            quantity,
            libraryBlob: images.libraryBlob ?? existingCard.libraryBlob,
            image_url: images.imageUrl ?? existingCard.image_url,
            updated_at: timestamp,
          }
        : {
            id: inventoryId,
            fingerprint,
            quantity,
            libraryBlob: images.libraryBlob,
            card_name: result.identity.cardName,
            card_set: result.identity.setName,
            card_number: result.identity.printedCode,
            game_type: result.identity.game,
            rarity: result.identity.variant,
            image_url: images.imageUrl ?? null,
            pricing_status: "pending",
            current_price_raw: null,
            current_price_psa9: null,
            current_price_psa10: null,
            created_at: timestamp,
            updated_at: timestamp,
          };
      await rapidScanDb.inventoryCards.put(inventoryCard);

      const event: ScanEvent = {
        id: crypto.randomUUID(),
        captureJobId: job.id,
        inventoryId,
        idempotencyKey: job.idempotencyKey,
        fingerprint,
        fingerprintSource,
        quantityAction,
        libraryQuantity: quantity,
        pricingStatus: inventoryCard.pricing_status,
        sessionId: job.session.id,
        profileId: job.session.profileId,
        selectedSetCorrected: result.selectedSetCorrected,
        evidence: [...result.evidence],
        identity: { ...result.identity },
        confidence: result.identity.confidence,
        session: { ...job.session },
        rotation: job.rotation,
        capturedAt: job.createdAt,
        createdAt: now,
      };
      await rapidScanDb.scanEvents.add(event);

      const storedJob = await rapidScanDb.captureJobs.get(job.id);
      if (!storedJob) {
        throw new Error(`Capture job not found: ${job.id}`);
      }
      await rapidScanDb.captureJobs.put({
        ...storedJob,
        status: "saved",
        libraryBlob: images.libraryBlob ?? storedJob.libraryBlob,
        updatedAt: now,
        error: undefined,
      });

      return resultFromEvent(event);
    },
  );
}
