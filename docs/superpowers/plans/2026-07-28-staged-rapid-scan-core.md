# Staged Rapid Scan Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coupled Rapid Scan worker with a durable staged pipeline that accepts automatic or manual captures, identifies Yu-Gi-Oh cards locally, saves them immediately, and increments quantity for intentionally repeated cards.

**Architecture:** Persist a capture Blob and session context first, then process OCR, resolution, and inventory upsert as independent idempotent stages. Keep existing camera controls and current lookup fallbacks, but move pricing out of the capture/identification critical path and replace identifier-based duplicate rejection with physical-frame debouncing.

**Tech Stack:** React 18, TypeScript 5.8, Vite 7, Zustand, Dexie 4, IndexedDB, ONNX Runtime Web, PaddleOCR, Node 24 `node:test`

## Global Constraints

- Preserve every existing scanner and library feature.
- Keep OCR browser-local with bundled same-origin model and WASM assets.
- Do not require Ollama, cloud OCR, Supabase OCR functions, or a separate Mac service.
- Support automatic stable-frame capture and manual capture.
- Yu-Gi-Oh exact printed set/card code is the first optimized resolver.
- Save identified cards before pricing completes.
- An intentionally repeated identical card increments quantity.
- A processing retry must never increment quantity twice.
- Keep original, library-quality, and OCR-optimized image representations.
- Keep current iPhone Continuity Camera, Camo filtering, rotation, zoom, torch, tap-focus, camera fallback, and Retry behavior.
- Use `npm test`, `npm run typecheck`, `npm run build`, and focused ESLint before completion.

---

## File map

### New files

- `src/lib/rapidScan/contracts.ts` — shared session, capture, resolution, inventory, and status types.
- `src/lib/rapidScan/db.ts` — Dexie schema, database upgrade, and durable repositories.
- `src/lib/rapidScan/frameAnalysis.ts` — sharpness, glare, stability, and physical-frame fingerprints.
- `src/lib/rapidScan/autoCapture.ts` — automatic capture state machine.
- `src/lib/rapidScan/captureProfiles.ts` — standard, sleeved, foil, Prizm, Absolute, and custom policies.
- `src/lib/rapidScan/imagePipeline.ts` — original/library/OCR image preparation and regions of interest.
- `src/lib/rapidScan/session.ts` — persisted session selection and set/profile defaults.
- `src/lib/resolvers/contracts.ts` — adapter interface.
- `src/lib/resolvers/yugiohResolver.ts` — selected-set-first Yu-Gi-Oh resolver.
- `src/lib/rapidScan/inventoryUpsert.ts` — fingerprint and idempotent create/increment transaction.
- `src/components/scanner/RapidScanSessionBar.tsx` — game, set, profile, and capture-mode controls.
- `tests/rapid-scan-state.test.mjs` — state-machine and persistence policies.
- `tests/rapid-scan-capture.test.mjs` — capture profile, frame analysis, and auto-capture policies.
- `tests/rapid-scan-inventory.test.mjs` — fingerprint and idempotent quantity policies.
- `tests/rapid-scan-resolver.test.mjs` — exact selected-set and fallback resolution.
- `tests/rapid-scan-performance.test.mjs` — timing and endurance policy gates.

### Existing files to modify

- `src/lib/idbQueue.ts` — compatibility wrapper over the new capture repository.
- `src/lib/queueProcessor.ts` — orchestrate OCR, resolution, and inventory stages without pricing.
- `src/lib/rapidScan/scanPolicy.ts` — remove identifier duplicate rejection and keep confidence policy.
- `src/lib/rapidScan/scanRows.ts` — expose new durable states.
- `src/lib/localCards.ts` — read/write the Dexie inventory store while retaining existing exports.
- `src/lib/ocr/localCardOcr.ts` — accept an OCR image/ROI bundle.
- `src/lib/paddleOCR.ts` — accept Blob/ImageBitmap input without forced data URLs and keep one warm instance.
- `src/lib/cardOcrParser.ts` — use one canonical printed-code normalizer.
- `src/lib/yugiohSetCodeIndex.ts` — selected-set filtering and set enumeration.
- `src/hooks/use-scanner-settings.ts` — persist capture mode, selected set, and profile.
- `src/components/scanner/RapidScanCamera.tsx` — capture-only critical path, session bar, automatic capture.
- `src/components/scanner/QueueStatusIndicator.tsx` — staged counts.
- `src/lib/recentScans.ts` — quantity action and pending-price fields.
- `tests/rapid-scan-policy.test.mjs` — update duplicate expectations.
- `tests/rapid-scan-integration.test.mjs` — staged pipeline regression assertions.

---

### Task 1: Lock shared contracts and state transitions

**Files:**
- Create: `src/lib/rapidScan/contracts.ts`
- Create: `tests/rapid-scan-state.test.mjs`

**Interfaces:**
- Produces: `CaptureMode`, `CaptureProfileId`, `RapidScanSession`, `CaptureJobStatus`, `CaptureJob`, `ResolveResult`, `InventoryUpsertResult`, `canTransitionCaptureJob()`.

- [ ] **Step 1: Write the failing transition test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionCaptureJob } from "../src/lib/rapidScan/contracts.ts";

test("capture state machine permits forward and recovery transitions only", () => {
  assert.equal(canTransitionCaptureJob("captured", "processing_ocr"), true);
  assert.equal(canTransitionCaptureJob("processing_ocr", "identified"), true);
  assert.equal(canTransitionCaptureJob("identified", "saved"), true);
  assert.equal(canTransitionCaptureJob("processing_ocr", "needs_review"), true);
  assert.equal(canTransitionCaptureJob("identification_error", "captured"), true);
  assert.equal(canTransitionCaptureJob("saved", "processing_ocr"), false);
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `node --test tests/rapid-scan-state.test.mjs`

Expected: FAIL because `contracts.ts` does not exist.

- [ ] **Step 3: Add the shared contracts**

```ts
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
```

- [ ] **Step 4: Run the focused and existing tests**

Run: `node --test tests/rapid-scan-state.test.mjs tests/rapid-scan-policy.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add src/lib/rapidScan/contracts.ts tests/rapid-scan-state.test.mjs
git commit -m "test: lock rapid scan state contracts"
```

---

### Task 2: Introduce the durable Dexie database and migrate queued work

**Files:**
- Create: `src/lib/rapidScan/db.ts`
- Modify: `src/lib/idbQueue.ts`
- Modify: `src/lib/localCards.ts`
- Test: `tests/rapid-scan-state.test.mjs`

**Interfaces:**
- Consumes: `CaptureJob`, `CaptureJobStatus`.
- Produces: `rapidScanDb`, `enqueueCapture()`, `claimNextCapture()`, `transitionCapture()`, `retryCapture()`, `listCaptureMeta()`, `countCaptureStates()`.

- [ ] **Step 1: Extend the state test with atomic repository expectations**

Add a source-level regression test because Node's current suite has no browser IndexedDB:

```js
import { readFile } from "node:fs/promises";

test("Dexie schema contains durable capture, inventory, scan event, and idempotency indexes", async () => {
  const source = await readFile(new URL("../src/lib/rapidScan/db.ts", import.meta.url), "utf8");
  assert.match(source, /captureJobs:/);
  assert.match(source, /inventoryCards:/);
  assert.match(source, /scanEvents:/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /transaction\\("rw"/);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test tests/rapid-scan-state.test.mjs`

Expected: FAIL because `db.ts` is missing.

- [ ] **Step 3: Create the Dexie schema**

```ts
import Dexie, { type EntityTable } from "dexie";
import type { CaptureJob } from "./contracts";

export type InventoryCard = {
  id: string;
  fingerprint: string;
  quantity: number;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  game_type: string | null;
  rarity: string | null;
  image_url: string | null;
  pricing_status: "pending" | "priced" | "needs_source_page" | "pricing_error";
  current_price_raw: number | null;
  current_price_psa9: number | null;
  current_price_psa10: number | null;
  created_at: string;
  updated_at: string;
};

export type ScanEvent = {
  id: string;
  captureJobId: string;
  inventoryId: string;
  idempotencyKey: string;
  quantityAction: "created" | "incremented";
  sessionId: string;
  profileId: string;
  selectedSetCorrected: boolean;
  createdAt: number;
};

class CleanCardLocalDb extends Dexie {
  captureJobs!: EntityTable<CaptureJob, "id">;
  inventoryCards!: EntityTable<InventoryCard, "id">;
  scanEvents!: EntityTable<ScanEvent, "id">;

  constructor() {
    super("clean_card_local_v2");
    this.version(1).stores({
      captureJobs: "id, &idempotencyKey, status, createdAt, [status+createdAt]",
      inventoryCards: "id, &fingerprint, updated_at",
      scanEvents: "id, &idempotencyKey, captureJobId, inventoryId, createdAt",
    });
  }
}

export const rapidScanDb = new CleanCardLocalDb();
```

Implement `claimNextCapture()` with one `rapidScanDb.transaction("rw", rapidScanDb.captureJobs, ...)` transaction. Claim `captured` work or a `processing_ocr` lease older than 60 seconds and set `processingStartedAt` before returning it.

- [ ] **Step 4: Convert `idbQueue.ts` into a compatibility wrapper**

Retain its current exported function names so existing callers continue compiling. Map legacy statuses as follows:

```ts
const legacyStatus = {
  captured: "queued",
  processing_ocr: "processing",
  identified: "processing",
  saved: "success",
  needs_review: "error",
  identification_error: "error",
} as const;
```

When old `card_scout_pro/rapid_scan_queue` records exist, migrate them once to `captureJobs`, using `id` as both the job ID and initial idempotency key, then mark migration completion in localStorage as `rapid_scan_v2_queue_migrated=1`.

- [ ] **Step 5: Make `localCards.ts` use `inventoryCards` while preserving exports**

Keep `getAllCards()`, `getCardById()`, `insertCardDual()`, `updateCardDual()`, and `deleteCardDual()`. Convert between `InventoryCard` and the existing Supabase-generated row shape inside this file. Do not change component imports.

- [ ] **Step 6: Run verification**

Run:

```bash
npm test
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 7: Commit the database boundary**

```bash
git add src/lib/rapidScan/db.ts src/lib/idbQueue.ts src/lib/localCards.ts tests/rapid-scan-state.test.mjs
git commit -m "feat: add durable rapid scan database"
```

---

### Task 3: Replace identifier duplicate rejection with physical-frame debouncing

**Files:**
- Create: `src/lib/rapidScan/frameAnalysis.ts`
- Create: `tests/rapid-scan-capture.test.mjs`
- Modify: `src/lib/rapidScan/scanPolicy.ts`
- Modify: `src/lib/queueProcessor.ts`
- Modify: `tests/rapid-scan-policy.test.mjs`

**Interfaces:**
- Produces: `FrameMetrics`, `analyzeLumaFrame()`, `hammingDistance()`, `createPhysicalFrameDebouncer()`.

- [ ] **Step 1: Write the failing frame-debouncer tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createPhysicalFrameDebouncer, hammingDistance } from "../src/lib/rapidScan/frameAnalysis.ts";

test("identical automatic frames are suppressed but later physical cards are accepted", () => {
  const debounce = createPhysicalFrameDebouncer({ maxHashDistance: 2, cooldownMs: 1200 });
  assert.equal(debounce.accept({ hash: 0b1010n, capturedAt: 1000 }, "auto"), true);
  assert.equal(debounce.accept({ hash: 0b1010n, capturedAt: 1100 }, "auto"), false);
  assert.equal(debounce.accept({ hash: 0b1111n, capturedAt: 1200 }, "auto"), false);
  assert.equal(debounce.accept({ hash: 0b0101n, capturedAt: 1300 }, "auto"), true);
  assert.equal(debounce.accept({ hash: 0b1010n, capturedAt: 1400 }, "manual"), true);
});

test("hamming distance counts changed bits", () => {
  assert.equal(hammingDistance(0b1010n, 0b1111n), 2);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test tests/rapid-scan-capture.test.mjs`

Expected: FAIL because `frameAnalysis.ts` does not exist.

- [ ] **Step 3: Implement the pure debouncer**

```ts
export function hammingDistance(a: bigint, b: bigint): number {
  let value = a ^ b;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

export function createPhysicalFrameDebouncer(options: {
  maxHashDistance: number;
  cooldownMs: number;
}) {
  let previous: { hash: bigint; capturedAt: number } | null = null;
  return {
    accept(frame: { hash: bigint; capturedAt: number }, mode: "auto" | "manual"): boolean {
      if (mode === "manual") {
        previous = frame;
        return true;
      }
      const repeated =
        previous &&
        frame.capturedAt - previous.capturedAt < options.cooldownMs &&
        hammingDistance(frame.hash, previous.hash) <= options.maxHashDistance;
      if (!repeated) previous = frame;
      return !repeated;
    },
  };
}
```

- [ ] **Step 4: Remove card-identifier duplicate skipping**

Delete `createSessionDuplicateTracker()` use from `queueProcessor.ts`. Update `scanPolicy.ts` and its test so confidence helpers remain, but repeated set codes are not treated as duplicate physical cards.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: PASS, including a test proving two intentional scans of `SDY-046` are both allowed through identification. The end-to-end quantity increment assertion belongs to Task 7, after inventory upsert exists.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rapidScan/frameAnalysis.ts src/lib/rapidScan/scanPolicy.ts src/lib/queueProcessor.ts tests/rapid-scan-capture.test.mjs tests/rapid-scan-policy.test.mjs
git commit -m "fix: allow intentional duplicate card scans"
```

---

### Task 4: Add capture profiles and image preparation

**Files:**
- Create: `src/lib/rapidScan/captureProfiles.ts`
- Create: `src/lib/rapidScan/imagePipeline.ts`
- Modify: `src/lib/camera/cameraPolicy.ts`
- Modify: `src/lib/imageCompressor.ts`
- Test: `tests/rapid-scan-capture.test.mjs`

**Interfaces:**
- Produces: `CAPTURE_PROFILES`, `getCaptureProfile()`, `buildProfileConstraints()`, `prepareCaptureImages()`.

- [ ] **Step 1: Add failing profile tests**

```js
import { getCaptureProfile } from "../src/lib/rapidScan/captureProfiles.ts";

test("Prizm and Absolute profiles reduce highlights and require glare scoring", () => {
  const prizm = getCaptureProfile("chrome-prizm");
  const absolute = getCaptureProfile("absolute-high-gloss");
  assert.equal(prizm.glareScoring, true);
  assert.equal(absolute.glareScoring, true);
  assert.ok(prizm.exposureCompensation < 0);
  assert.ok(absolute.highlightCompression > 0);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/rapid-scan-capture.test.mjs`

Expected: FAIL because `captureProfiles.ts` is missing.

- [ ] **Step 3: Implement immutable profiles**

```ts
export type CaptureProfile = {
  id: CaptureProfileId;
  label: string;
  exposureCompensation: number;
  contrast: number;
  highlightCompression: number;
  glareScoring: boolean;
  burstFrames: number;
};

export const CAPTURE_PROFILES: Record<CaptureProfileId, CaptureProfile> = {
  standard: { id: "standard", label: "Standard / Matte", exposureCompensation: 0, contrast: 1.05, highlightCompression: 0, glareScoring: false, burstFrames: 1 },
  sleeved: { id: "sleeved", label: "Sleeved", exposureCompensation: -0.2, contrast: 1.08, highlightCompression: 0.15, glareScoring: true, burstFrames: 2 },
  foil: { id: "foil", label: "Foil / Holographic", exposureCompensation: -0.45, contrast: 1.15, highlightCompression: 0.35, glareScoring: true, burstFrames: 3 },
  "chrome-prizm": { id: "chrome-prizm", label: "Chrome / Prizm", exposureCompensation: -0.6, contrast: 1.18, highlightCompression: 0.45, glareScoring: true, burstFrames: 3 },
  "absolute-high-gloss": { id: "absolute-high-gloss", label: "Absolute / High Gloss", exposureCompensation: -0.5, contrast: 1.15, highlightCompression: 0.4, glareScoring: true, burstFrames: 3 },
  custom: { id: "custom", label: "Custom", exposureCompensation: 0, contrast: 1, highlightCompression: 0, glareScoring: true, burstFrames: 1 },
};
```

- [ ] **Step 4: Implement image preparation**

`prepareCaptureImages(originalBlob, profileId, rotation)` must return:

```ts
export type PreparedCaptureImages = {
  originalBlob: Blob;
  libraryBlob: Blob;
  ocrBlob: Blob;
  metrics: { sharpness: number; glareRatio: number; perceptualHash: bigint };
};
```

Use `createImageBitmap`, `OffscreenCanvas` when available, and normal canvas fallback. Preserve the original Blob unchanged. Apply highlight compression and grayscale/local contrast only to `ocrBlob`. Revoke every temporary object URL in `finally`.

- [ ] **Step 5: Add capability-gated camera constraints**

`buildProfileConstraints(profile, capabilities)` includes exposure compensation only when the capability range exists. It must never send unsupported keys to `applyConstraints`.

- [ ] **Step 6: Verify**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rapidScan/captureProfiles.ts src/lib/rapidScan/imagePipeline.ts src/lib/camera/cameraPolicy.ts src/lib/imageCompressor.ts tests/rapid-scan-capture.test.mjs
git commit -m "feat: add reflective card capture profiles"
```

---

### Task 5: Add persisted session context and the session bar

**Files:**
- Create: `src/lib/rapidScan/session.ts`
- Create: `src/components/scanner/RapidScanSessionBar.tsx`
- Modify: `src/hooks/use-scanner-settings.ts`
- Modify: `src/components/scanner/RapidScanCamera.tsx`
- Test: `tests/rapid-scan-capture.test.mjs`

**Interfaces:**
- Produces: `getRapidScanSession()`, `saveRapidScanSession()`, `RapidScanSessionBar`.

- [ ] **Step 1: Write a failing session-normalization test**

```js
import { normalizeRapidScanSession } from "../src/lib/rapidScan/session.ts";

test("session defaults to Yu-Gi-Oh, manual capture, and standard profile", () => {
  assert.deepEqual(normalizeRapidScanSession({}), {
    id: "active",
    game: "yugioh",
    selectedSetId: null,
    selectedSetName: null,
    profileId: "standard",
    captureMode: "manual",
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/rapid-scan-capture.test.mjs`

Expected: FAIL because `session.ts` is missing.

- [ ] **Step 3: Extend scanner settings**

Add:

```ts
captureMode: "auto" | "manual";
selectedSetId: string | null;
selectedSetName: string | null;
captureProfileId: CaptureProfileId;
```

Merge stored settings with defaults exactly as the existing hook does, so old localStorage remains compatible.

- [ ] **Step 4: Build the session bar**

Props:

```ts
type RapidScanSessionBarProps = {
  session: RapidScanSession;
  sets: Array<{ id: string; name: string }>;
  counts: Record<"captured" | "processing" | "saved" | "review" | "errors", number>;
  onChange(next: RapidScanSession): void;
};
```

Use existing shadcn `Select`, `Badge`, and `Button` components. Do not replace the camera button or preview.

- [ ] **Step 5: Integrate above the preview**

In `RapidScanCamera.tsx`, derive the session once per capture and store it inside the job. Changing the UI after capture must not mutate queued jobs.

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rapidScan/session.ts src/components/scanner/RapidScanSessionBar.tsx src/hooks/use-scanner-settings.ts src/components/scanner/RapidScanCamera.tsx tests/rapid-scan-capture.test.mjs
git commit -m "feat: add rapid scan session controls"
```

---

### Task 6: Implement the selected-set-first Yu-Gi-Oh resolver

**Files:**
- Create: `src/lib/resolvers/contracts.ts`
- Create: `src/lib/resolvers/yugiohResolver.ts`
- Create: `tests/rapid-scan-resolver.test.mjs`
- Modify: `src/lib/yugiohSetCodeIndex.ts`
- Modify: `src/lib/cardOcrParser.ts`
- Modify: `src/lib/rapidBasicLookupClient.ts`

**Interfaces:**
- Consumes: the shared `ResolveResult` from `src/lib/rapidScan/contracts.ts`.
- Produces: `CardResolver`, `ResolveRequest`, `yugiohResolver.resolve()`, `listYugiohSets()`.

- [ ] **Step 1: Write the failing resolver policy test**

```js
import { rankResolverCandidates } from "../src/lib/resolvers/yugiohResolver.ts";

test("exact printed code wins and can correct a selected set", () => {
  const result = rankResolverCandidates(
    { printedCode: "SDY-046", selectedSetId: "LOB" },
    [
      { printedCode: "LOB-005", setId: "LOB", cardName: "Wrong" },
      { printedCode: "SDY-046", setId: "SDY", cardName: "Dark Magician" },
    ],
  );
  assert.equal(result.match.cardName, "Dark Magician");
  assert.equal(result.selectedSetCorrected, true);
  assert.equal(result.confidence, 0.98);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/rapid-scan-resolver.test.mjs`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Define the adapter**

```ts
export type ResolveRequest = {
  session: RapidScanSession;
  ocr: LocalCardOcrResult;
};

export interface CardResolver {
  readonly game: RapidScanSession["game"];
  listSets(): Promise<Array<{ id: string; name: string }>>;
  resolve(request: ResolveRequest): Promise<ResolveResult>;
}
```

- [ ] **Step 4: Use one canonical code normalizer**

Export `normalizeYugiohPrintedCode()` from `yugiohSetCodeIndex.ts` and import it in `cardOcrParser.ts`, `yugiohDirectLookup.ts`, and `yugiohResolver.ts`. Remove conflicting normalizers after tests pass.

- [ ] **Step 5: Keep lookup fallback but remove pricing from resolution output**

The resolver returns identity only. Existing YGOPRODeck fallback may provide identity/image metadata, but its price must not be treated as PriceCharting pricing.

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/resolvers src/lib/yugiohSetCodeIndex.ts src/lib/cardOcrParser.ts src/lib/rapidBasicLookupClient.ts tests/rapid-scan-resolver.test.mjs
git commit -m "feat: add selected-set Yu-Gi-Oh resolver"
```

---

### Task 7: Add idempotent inventory create-or-increment and scan events

**Files:**
- Create: `src/lib/rapidScan/inventoryUpsert.ts`
- Create: `tests/rapid-scan-inventory.test.mjs`
- Modify: `src/lib/rapidScan/db.ts`
- Modify: `src/lib/localCards.ts`
- Modify: `src/lib/recentScans.ts`

**Interfaces:**
- Produces: `buildCardFingerprint()`, `upsertIdentifiedCapture()`.

- [ ] **Step 1: Write failing fingerprint and retry tests**

```js
import { buildCardFingerprint, planInventoryMutation } from "../src/lib/rapidScan/inventoryUpsert.ts";

test("same ungraded card increments quantity but a different grade stays separate", () => {
  const raw = buildCardFingerprint({
    game: "yugioh", language: "EN", printedCode: "SDY-046",
    edition: "1st", variant: "ultra-rare", gradingCompany: "ungraded", grade: "ungraded",
  });
  const graded = buildCardFingerprint({
    game: "yugioh", language: "EN", printedCode: "SDY-046",
    edition: "1st", variant: "ultra-rare", gradingCompany: "PSA", grade: "10",
  });
  assert.notEqual(raw, graded);
  assert.equal(planInventoryMutation({ quantity: 1 }, "new-capture").nextQuantity, 2);
  assert.equal(planInventoryMutation({ quantity: 2 }, "retry-existing-event").nextQuantity, 2);
});

test("two intentional captures of SDY-046 increment quantity exactly once each", () => {
  assert.equal(planInventoryMutation({ quantity: 1 }, "new-capture").nextQuantity, 2);
  assert.equal(planInventoryMutation({ quantity: 2 }, "retry-existing-event").nextQuantity, 2);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/rapid-scan-inventory.test.mjs`

Expected: FAIL because `inventoryUpsert.ts` is missing.

- [ ] **Step 3: Implement canonical fingerprinting**

Normalize every component to trimmed lowercase and join with `\u001f`. Hash with SHA-256 for storage, but keep the normalized source string on the scan event for diagnostics.

- [ ] **Step 4: Implement one Dexie transaction**

`upsertIdentifiedCapture(job, result, images)` opens one read/write transaction over `inventoryCards`, `scanEvents`, and `captureJobs`:

1. Return the existing scan event when `idempotencyKey` already exists.
2. Find inventory by unique fingerprint.
3. Create quantity `1` or increment by exactly `1`.
4. Add the scan event.
5. Mark the capture job `saved`.
6. Return `{ inventoryId, quantity, action }`.

- [ ] **Step 5: Keep recent scan display compatible**

Add `quantityAction`, `pricingStatus`, and `libraryQuantity` to `RecentScan`. Do not use recent-scans localStorage as the idempotency source.

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rapidScan/inventoryUpsert.ts src/lib/rapidScan/db.ts src/lib/localCards.ts src/lib/recentScans.ts tests/rapid-scan-inventory.test.mjs
git commit -m "feat: increment duplicate inventory atomically"
```

---

### Task 8: Refactor the queue processor into identification and save stages

**Files:**
- Modify: `src/lib/queueProcessor.ts`
- Modify: `src/lib/ocr/localCardOcr.ts`
- Modify: `src/lib/paddleOCR.ts`
- Modify: `src/lib/rapidScan/scanRows.ts`
- Modify: `tests/rapid-scan-integration.test.mjs`

**Interfaces:**
- Consumes: `claimNextCapture()`, `prepareCaptureImages()`, `CardResolver.resolve()`, `upsertIdentifiedCapture()`.
- Produces: updated `useQueueProcessor` state and browser events.

- [ ] **Step 1: Replace source-string assertions with staged-pipeline assertions**

```js
test("worker does not convert to base64 or wait for pricing before save", async () => {
  const source = await read("src/lib/queueProcessor.ts");
  assert.doesNotMatch(source, /blobToBase64DataUrl/);
  assert.doesNotMatch(source, /hasReadablePrice/);
  assert.match(source, /prepareCaptureImages/);
  assert.match(source, /upsertIdentifiedCapture/);
  assert.match(source, /pricingStatus:\\s*"pending"/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/rapid-scan-integration.test.mjs`

Expected: FAIL because the old coupled worker still contains base64 and pricing.

- [ ] **Step 3: Implement the staged worker**

The processing function must follow this order:

```ts
const job = await claimNextCapture();
const images = await prepareCaptureImages(job.originalBlob, job.session.profileId, job.rotation);
const ocr = await runLocalCardOcr(images.ocrBlob);
const result = await resolverFor(job.session.game).resolve({ session: job.session, ocr });

if (result.status !== "identified") {
  await transitionCapture(job.id, result.status === "needs_review" ? "needs_review" : "identification_error");
  return;
}

const saved = await upsertIdentifiedCapture(job, result, images);
publishSavedScan({ ...saved, pricingStatus: "pending" });
```

Use one OCR worker initially. Remove `MIN_JOB_DELAY_MS` after endurance testing proves queue fairness without it.

- [ ] **Step 4: Let PaddleOCR accept Blob/ImageBitmap**

Use `createImageBitmap()` and canvas internally. Keep string input compatibility for other callers. Do not call `FileReader.readAsDataURL()` in the Rapid Scan path.

- [ ] **Step 5: Expose new row states**

Map `captured`, `processing_ocr`, `identified`, `saved`, `needs_review`, and `identification_error` to reader-facing row badges without hiding failed rows.

- [ ] **Step 6: Verify**

Run:

```bash
npm test
npm run typecheck
npm run build
npx eslint src/lib/queueProcessor.ts src/lib/ocr/localCardOcr.ts src/lib/paddleOCR.ts src/lib/rapidScan/scanRows.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queueProcessor.ts src/lib/ocr/localCardOcr.ts src/lib/paddleOCR.ts src/lib/rapidScan/scanRows.ts tests/rapid-scan-integration.test.mjs
git commit -m "refactor: stage rapid scan identification"
```

---

### Task 9: Add automatic stable-frame capture without altering manual capture

**Files:**
- Create: `src/lib/rapidScan/autoCapture.ts`
- Modify: `src/components/scanner/RapidScanCamera.tsx`
- Modify: `tests/rapid-scan-capture.test.mjs`

**Interfaces:**
- Produces: `createAutoCaptureController()`, `AutoCaptureDecision`.

- [ ] **Step 1: Write failing state-machine tests**

```js
import { createAutoCaptureController } from "../src/lib/rapidScan/autoCapture.ts";

test("auto capture requires three stable good frames and rearms after a different card", () => {
  const c = createAutoCaptureController({ requiredStableFrames: 3, minSharpness: 40, maxGlareRatio: 0.08 });
  const good = { sharpness: 60, glareRatio: 0.02, perceptualHash: 1n };
  assert.equal(c.observe(good).capture, false);
  assert.equal(c.observe(good).capture, false);
  assert.equal(c.observe(good).capture, true);
  assert.equal(c.observe(good).capture, false);
  assert.equal(c.observe({ ...good, perceptualHash: 15n }).rearmed, true);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/rapid-scan-capture.test.mjs`

Expected: FAIL because `autoCapture.ts` is missing.

- [ ] **Step 3: Implement the pure controller**

The controller tracks stable-frame count, armed state, last accepted hash, and cooldown. It returns `{ capture, rearmed, reason }` and contains no DOM calls.

- [ ] **Step 4: Integrate with video frames**

Use `requestVideoFrameCallback` when available and a 100 ms `requestAnimationFrame` throttle otherwise. Analyze a downscaled luma canvas. Call the existing `capture()` function only when `session.captureMode === "auto"` and the controller returns `capture: true`.

Manual button behavior remains unchanged.

- [ ] **Step 5: Verify camera cleanup**

Cancel callbacks when camera stops or component unmounts. Confirm only one analysis loop exists after camera switching.

- [ ] **Step 6: Run verification**

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rapidScan/autoCapture.ts src/components/scanner/RapidScanCamera.tsx tests/rapid-scan-capture.test.mjs
git commit -m "feat: add stable-frame automatic capture"
```

---

### Task 10: Add staged status UI, metrics, and endurance gates

**Files:**
- Create: `src/lib/rapidScan/metrics.ts`
- Create: `tests/rapid-scan-performance.test.mjs`
- Modify: `src/components/scanner/RapidScanCamera.tsx`
- Modify: `src/components/scanner/QueueStatusIndicator.tsx`
- Modify: `src/lib/queueProcessor.ts`

**Interfaces:**
- Produces: `recordRapidScanMetric()`, `summarizeRapidScanMetrics()`.

- [ ] **Step 1: Write failing metric tests**

```js
import { summarizeRapidScanMetrics } from "../src/lib/rapidScan/metrics.ts";

test("metrics report median and p95 without discarding zero values", () => {
  const summary = summarizeRapidScanMetrics([0, 100, 150, 200, 300]);
  assert.equal(summary.median, 150);
  assert.equal(summary.p95, 300);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/rapid-scan-performance.test.mjs`

Expected: FAIL because `metrics.ts` is missing.

- [ ] **Step 3: Instrument the required boundaries**

Record:

- `capture_to_persist_ms`
- `camera_rearm_ms`
- `ocr_ms`
- `resolve_ms`
- `inventory_upsert_ms`
- queue depth
- lost-capture count

Store only the latest 500 samples per metric in memory and export a diagnostic JSON snapshot on demand.

- [ ] **Step 4: Update status components**

Show `Captured`, `OCR queue`, `Saved`, `Needs review`, and `Errors`. Keep the floating status indicator minimized by default.

- [ ] **Step 5: Add the synthetic endurance test**

Generate 250 unique capture IDs plus 25 retry attempts. Assert 250 unique scan-event idempotency keys and exactly 250 quantity mutations.

- [ ] **Step 6: Run the complete verification suite**

Run:

```bash
npm ci
npm test
npm run typecheck
npm run build
npx eslint src/lib/rapidScan src/lib/resolvers src/lib/queueProcessor.ts src/components/scanner/RapidScanCamera.tsx src/components/scanner/RapidScanSessionBar.tsx
git diff --check
```

Expected: every command PASS.

- [ ] **Step 7: Perform hardware acceptance**

On the M3 Pro with iPhone Continuity Camera:

1. Run a 25-card standard session.
2. Run a 10-card sleeved/foil session.
3. Run a 10-card Absolute/Prizm-style session.
4. Scan two intentional copies of the same card and confirm quantity increases to two.
5. Refresh during an OCR job and confirm it resumes once.
6. Export metrics and confirm camera rearm is at most 300 ms and capture persistence p95 is at most 150 ms.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rapidScan/metrics.ts tests/rapid-scan-performance.test.mjs src/components/scanner/RapidScanCamera.tsx src/components/scanner/QueueStatusIndicator.tsx src/lib/queueProcessor.ts
git commit -m "test: enforce rapid scan performance gates"
```
