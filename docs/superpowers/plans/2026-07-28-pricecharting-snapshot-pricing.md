# PriceCharting Snapshot and Background Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import complete user-saved PriceCharting set pages into a durable local catalog and price already-saved cards asynchronously with raw/ungraded, grade 9, and Grade 10/PSA 10 values.

**Architecture:** Preserve each imported page unchanged, decode it into staged normalized rows, validate the entire import, and commit source/catalog/price records atomically. A separate durable pricing worker matches saved inventory to the local catalog and updates values without blocking capture or changing quantity.

**Tech Stack:** React 18, TypeScript 5.8, Vite 7, Dexie 4, IndexedDB, JSZip 3, Web Crypto SHA-256, DOMParser, LinkeDOM 0.18, Node 24 `node:test`

## Global Constraints

- This plan starts after the Staged Rapid Scan Core plan database and inventory tasks pass.
- Required card fields are name, number, set, raw/ungraded price, grade 9 price, and Grade 10/PSA 10 price.
- Preserve the complete imported source page as an immutable Blob.
- Missing prices are `null`, never zero.
- Importing a newer page creates a new snapshot; it does not delete price history.
- Do not execute scripts from imported pages.
- Do not automate unauthorized scraping or bypass authentication/access controls.
- A missing set page is `needs_source_page`, not a scan failure.
- Pricing never blocks capture, OCR, identification, or inventory quantity updates.
- Preserve existing XLSX import support while adding complete-page import.
- Use synthetic parser fixtures in the repository; do not commit copied PriceCharting pages.

---

## File map

### New files

- `src/lib/priceCatalog/contracts.ts` — source-page, catalog-card, price-snapshot, and pricing-job types.
- `src/lib/priceCatalog/normalize.ts` — money, text, set, and product identity normalization.
- `src/lib/priceCatalog/htmlParser.ts` — inert HTML row extraction.
- `src/lib/priceCatalog/mhtmlParser.ts` — multipart MHTML decoding.
- `src/lib/priceCatalog/webarchiveParser.ts` — Safari Web Archive main-resource extraction.
- `src/lib/priceCatalog/pageContainer.ts` — dispatch HTML/ZIP/MHTML/Web Archive inputs.
- `src/lib/priceCatalog/importService.ts` — hash, stage, validate, and atomic commit.
- `src/lib/priceCatalog/catalogRepository.ts` — selected-set list and exact card lookup.
- `src/lib/priceCatalog/pricingQueue.ts` — durable pricing job repository.
- `src/lib/priceCatalog/pricingWorker.ts` — background matching and inventory price update.
- `src/components/price-db/SavedPageImport.tsx` — page selection, validation preview, import progress.
- `tests/price-catalog-normalize.test.mjs`
- `tests/price-catalog-parsers.test.mjs`
- `tests/price-catalog-import.test.mjs`
- `tests/price-catalog-pricing.test.mjs`
- `tests/fixtures/pricecharting-synthetic-set.html`
- `tests/fixtures/pricecharting-synthetic-set.mhtml`
- `tests/fixtures/pricecharting-synthetic-webarchive.plist`

### Existing files to modify

- `src/lib/rapidScan/db.ts` — add source, catalog, snapshot, and pricing-job tables.
- `src/lib/priceChartingImport.ts` — share normalized contracts and retain XLSX adapter.
- `src/lib/yugiohSetCodeIndex.ts` — query imported catalog first, bundled JSON second.
- `src/lib/queueProcessor.ts` — enqueue pricing after inventory save.
- `src/lib/localCards.ts` — price-only update function.
- `src/pages/PriceDatabasePage.tsx` — local set listing and Saved Page import.
- `src/components/price-db/SetCardsList.tsx` — read local catalog instead of disabled Supabase tables.
- `src/components/scanner/QueueStatusIndicator.tsx` — waiting-for-price and pricing-error counts.
- `src/hooks/use-queue-auto-resume.ts` — resume identification and pricing workers independently.
- `package.json` — add browser-safe binary plist parser and test script coverage if required.

---

### Task 1: Define normalized price-catalog contracts

**Files:**
- Create: `src/lib/priceCatalog/contracts.ts`
- Create: `src/lib/priceCatalog/normalize.ts`
- Create: `tests/price-catalog-normalize.test.mjs`

**Interfaces:**
- Produces: `PriceCatalogRow`, `SourcePageRecord`, `PriceSnapshot`, `PricingJob`, `moneyOrNull()`, `normalizeCatalogKey()`.

- [ ] **Step 1: Write failing normalization tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { moneyOrNull, normalizeCatalogKey } from "../src/lib/priceCatalog/normalize.ts";

test("prices preserve missing values and reject zero placeholders", () => {
  assert.equal(moneyOrNull("$12.34"), 12.34);
  assert.equal(moneyOrNull("1,234.56"), 1234.56);
  assert.equal(moneyOrNull("—"), null);
  assert.equal(moneyOrNull("$0.00"), null);
});

test("catalog keys bind game, set, card number, and variant", () => {
  assert.equal(
    normalizeCatalogKey({ game: "Yu-Gi-Oh", setName: "Starter Deck Yugi", cardNumber: "SDY-046", variant: "1st Edition" }),
    "yugioh\u001fstarter deck yugi\u001fsdy-046\u001f1st edition",
  );
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/price-catalog-normalize.test.mjs`

Expected: FAIL because the modules are missing.

- [ ] **Step 3: Define exact row types**

```ts
export type PriceCatalogRow = {
  id: string;
  catalogKey: string;
  game: string;
  setName: string;
  setCode: string | null;
  cardName: string;
  cardNumber: string | null;
  variant: string | null;
  rawUngradedPrice: number | null;
  grade9Price: number | null;
  grade10Price: number | null;
  productId: string | null;
  productUrl: string | null;
  sourcePageId: string;
  priceDate: number;
};

export type SourcePageRecord = {
  id: string;
  sha256: string;
  sourceUrl: string | null;
  game: string;
  setName: string;
  importedAt: number;
  parserVersion: string;
  mime: string;
  originalBlob: Blob;
  rowCount: number;
};

export type PriceSnapshot = {
  id: string;
  catalogCardId: string;
  inventoryId: string | null;
  sourcePageId: string;
  rawUngradedPrice: number | null;
  grade9Price: number | null;
  grade10Price: number | null;
  capturedAt: number;
};

export type PricingJobStatus =
  | "pricing_pending"
  | "pricing_processing"
  | "priced"
  | "needs_source_page"
  | "pricing_error";

export type PricingJob = {
  id: string;
  inventoryId: string;
  status: PricingJobStatus;
  createdAt: number;
  updatedAt: number;
  processingStartedAt?: number;
  retryCount: number;
  error?: string;
};
```

- [ ] **Step 4: Implement normalization**

`moneyOrNull()` accepts numeric values or strings, strips currency symbols and commas, and returns a positive two-decimal number or `null`. `normalizeCatalogKey()` lowercases, Unicode-normalizes with `NFKC`, collapses whitespace, and joins components with `\u001f`.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/price-catalog-normalize.test.mjs`

Expected: PASS.

```bash
git add src/lib/priceCatalog/contracts.ts src/lib/priceCatalog/normalize.ts tests/price-catalog-normalize.test.mjs
git commit -m "test: define price catalog contracts"
```

---

### Task 2: Extend the local database for sources, catalog rows, snapshots, and pricing jobs

**Files:**
- Modify: `src/lib/rapidScan/db.ts`
- Create: `tests/price-catalog-import.test.mjs`

**Interfaces:**
- Produces: `sourcePages`, `catalogCards`, `priceSnapshots`, `pricingJobs` Dexie tables.

- [ ] **Step 1: Add a failing schema regression test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local database contains catalog and pricing tables", async () => {
  const source = await readFile(new URL("../src/lib/rapidScan/db.ts", import.meta.url), "utf8");
  for (const table of ["sourcePages", "catalogCards", "priceSnapshots", "pricingJobs"]) {
    assert.match(source, new RegExp(`${table}:`));
  }
  assert.match(source, /&sha256/);
  assert.match(source, /\\[status\\+createdAt\\]/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/price-catalog-import.test.mjs`

Expected: FAIL because the new tables are absent.

- [ ] **Step 3: Add Dexie version 2**

```ts
this.version(2).stores({
  captureJobs: "id, &idempotencyKey, status, createdAt, [status+createdAt]",
  inventoryCards: "id, &fingerprint, pricing_status, updated_at",
  scanEvents: "id, &idempotencyKey, captureJobId, inventoryId, createdAt",
  sourcePages: "id, &sha256, [game+setName], importedAt",
  catalogCards: "id, catalogKey, [game+setName], cardNumber, sourcePageId",
  priceSnapshots: "id, catalogCardId, inventoryId, capturedAt, sourcePageId",
  pricingJobs: "id, &inventoryId, status, createdAt, [status+createdAt]",
});
```

Do not delete or clear version 1 tables during upgrade.

- [ ] **Step 4: Run verification and commit**

Run: `npm test && npm run typecheck`

Expected: PASS.

```bash
git add src/lib/rapidScan/db.ts tests/price-catalog-import.test.mjs
git commit -m "feat: add local price catalog schema"
```

---

### Task 3: Parse inert saved HTML and HTML-plus-assets ZIP

**Files:**
- Create: `src/lib/priceCatalog/htmlParser.ts`
- Create: `src/lib/priceCatalog/pageContainer.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/price-catalog-parsers.test.mjs`
- Create: `tests/fixtures/pricecharting-synthetic-set.html`

**Interfaces:**
- Produces: `parsePriceChartingHtml()`, `decodePageContainer()`.

- [ ] **Step 1: Add the test DOM dependency and a synthetic fixture**

Install:

```bash
npm install --save-dev linkedom@0.18.13
```

The fixture contains a fake set title and two fake rows with links and the three required price columns. Use invented names such as `Test Dragon` and `Example Wizard`; do not copy a live PriceCharting page.

- [ ] **Step 2: Write the failing parser test**

```js
test("HTML parser extracts required identity and price columns", async () => {
  const html = await readFile(new URL("./fixtures/pricecharting-synthetic-set.html", import.meta.url), "utf8");
  const result = parsePriceChartingHtml(html, { sourceUrl: "https://example.invalid/game/test-set" });
  assert.equal(result.setName, "Synthetic Test Set");
  assert.deepEqual(result.rows[0], {
    cardName: "Test Dragon",
    cardNumber: "TST-001",
    variant: null,
    rawUngradedPrice: 1.25,
    grade9Price: 8.5,
    grade10Price: 20,
    productId: "1001",
    productUrl: "https://example.invalid/product/1001",
  });
});
```

- [ ] **Step 3: Run and verify failure**

Run: `node --test tests/price-catalog-parsers.test.mjs`

Expected: FAIL because the parser is missing.

- [ ] **Step 4: Implement inert DOM parsing**

Use the browser's `DOMParser().parseFromString(html, "text/html")`. In the Node test setup, install LinkeDOM's `DOMParser` on `globalThis` before importing the parser. Remove `script`, `iframe`, `object`, `embed`, and `base` elements before querying. Resolve links against the supplied source URL without loading them.

Recognize columns by normalized header aliases:

```ts
const HEADER_ALIASES = {
  name: ["product", "card", "card name", "name"],
  number: ["number", "card number", "#"],
  raw: ["ungraded", "raw", "loose"],
  grade9: ["grade 9", "psa 9"],
  grade10: ["grade 10", "psa 10"],
} as const;
```

Reject pages that have no set identity or no rows with both a name and a price/number.

- [ ] **Step 5: Decode HTML ZIP containers**

Use existing `JSZip`. Select the root HTML file with the greatest number of table/product-row matches; asset files remain in the original source Blob and are not executed.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/price-catalog-parsers.test.mjs`

Expected: PASS.

```bash
git add package.json package-lock.json src/lib/priceCatalog/htmlParser.ts src/lib/priceCatalog/pageContainer.ts tests/price-catalog-parsers.test.mjs tests/fixtures/pricecharting-synthetic-set.html
git commit -m "feat: parse saved PriceCharting HTML"
```

---

### Task 4: Decode Chromium MHTML

**Files:**
- Create: `src/lib/priceCatalog/mhtmlParser.ts`
- Modify: `src/lib/priceCatalog/pageContainer.ts`
- Create: `tests/fixtures/pricecharting-synthetic-set.mhtml`
- Modify: `tests/price-catalog-parsers.test.mjs`

**Interfaces:**
- Produces: `extractMainHtmlFromMhtml()`.

- [ ] **Step 1: Write the failing MHTML test**

```js
test("MHTML decoder returns the main HTML and content location", async () => {
  const bytes = await readFile(new URL("./fixtures/pricecharting-synthetic-set.mhtml", import.meta.url));
  const decoded = extractMainHtmlFromMhtml(bytes);
  assert.equal(decoded.sourceUrl, "https://example.invalid/game/test-set");
  assert.match(decoded.html, /Synthetic Test Set/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/price-catalog-parsers.test.mjs`

Expected: FAIL because `mhtmlParser.ts` is missing.

- [ ] **Step 3: Implement multipart decoding**

Parse the top-level `Content-Type` boundary, unfold MIME headers, locate the first `text/html` part, and decode `base64` or `quoted-printable`. Return `{ html, sourceUrl }` from the part's `Content-Location`.

Reject missing boundaries, parts larger than 50 MB, and archives without an HTML part.

- [ ] **Step 4: Wire MIME dispatch**

`decodePageContainer(file)` dispatches `.mhtml` and `multipart/related` to the MHTML decoder, then passes decoded HTML to `parsePriceChartingHtml`.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run typecheck`

Expected: PASS.

```bash
git add src/lib/priceCatalog/mhtmlParser.ts src/lib/priceCatalog/pageContainer.ts tests/fixtures/pricecharting-synthetic-set.mhtml tests/price-catalog-parsers.test.mjs
git commit -m "feat: decode saved MHTML pages"
```

---

### Task 5: Decode Safari Web Archive

**Files:**
- Create: `src/lib/priceCatalog/webarchiveParser.ts`
- Modify: `src/lib/priceCatalog/pageContainer.ts`
- Modify: `package.json`
- Create: `tests/fixtures/pricecharting-synthetic-webarchive.plist`
- Modify: `tests/price-catalog-parsers.test.mjs`

**Interfaces:**
- Produces: `extractMainHtmlFromWebArchive()`.

- [ ] **Step 1: Add the dependency and a synthetic fixture**

Install:

```bash
npm install bplist-parser@0.3.2 buffer@6.0.3
```

The fixture contains an invented HTML main resource and URL only. Add `buffer` to Vite's optimized dependencies if the package requires it in browser builds.

- [ ] **Step 2: Write the failing Web Archive test**

```js
test("Safari Web Archive decoder extracts the main HTML resource", async () => {
  const bytes = await readFile(new URL("./fixtures/pricecharting-synthetic-webarchive.plist", import.meta.url));
  const decoded = extractMainHtmlFromWebArchive(bytes);
  assert.equal(decoded.sourceUrl, "https://example.invalid/game/test-set");
  assert.match(decoded.html, /Synthetic Test Set/);
});
```

- [ ] **Step 3: Run and verify failure**

Run: `node --test tests/price-catalog-parsers.test.mjs`

Expected: FAIL because the decoder is missing.

- [ ] **Step 4: Implement main-resource extraction**

Parse binary plist with `bplist-parser`; parse XML plist with `DOMParser`. Read `WebMainResource.WebResourceData`, `WebResourceMIMEType`, `WebResourceTextEncodingName`, and `WebResourceURL`. Require `text/html`, decode bytes with `TextDecoder`, and return `{ html, sourceUrl }`.

- [ ] **Step 5: Prove browser compatibility**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: PASS. If `bplist-parser` cannot build in Vite after the explicit `buffer` dependency and configuration, stop this task and report the package incompatibility; do not silently omit Web Archive support.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/priceCatalog/webarchiveParser.ts src/lib/priceCatalog/pageContainer.ts tests/fixtures/pricecharting-synthetic-webarchive.plist tests/price-catalog-parsers.test.mjs
git commit -m "feat: decode Safari Web Archives"
```

---

### Task 6: Stage, validate, hash, and atomically import a complete page

**Files:**
- Create: `src/lib/priceCatalog/importService.ts`
- Modify: `src/lib/rapidScan/db.ts`
- Modify: `tests/price-catalog-import.test.mjs`

**Interfaces:**
- Produces: `previewSavedPageImport()`, `commitSavedPageImport()`, `commitStagedCatalogRows()`, `SavedPageImportPreview`, `SavedPageImportResult`.

- [ ] **Step 1: Write failing validation tests**

```js
test("import validation rejects duplicate card keys and never commits partial rows", () => {
  const preview = validateStagedImport({
    game: "yugioh",
    setName: "Synthetic Test Set",
    rows: [
      fakeRow({ cardNumber: "TST-001" }),
      fakeRow({ cardNumber: "TST-001" }),
    ],
  });
  assert.equal(preview.valid, false);
  assert.match(preview.errors[0], /duplicate/i);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/price-catalog-import.test.mjs`

Expected: FAIL because `importService.ts` is missing.

- [ ] **Step 3: Implement preview**

`previewSavedPageImport(file)`:

1. Enforces a 50 MB file limit.
2. Calls `navigator.storage.estimate()` when available.
3. Computes SHA-256 with `crypto.subtle.digest`.
4. Detects an existing `sourcePages.sha256`.
5. Decodes and parses without database writes.
6. Returns set/game, row counts, warnings, errors, and normalized staged rows.

- [ ] **Step 4: Implement atomic commit**

Use one Dexie read/write transaction over `sourcePages`, `catalogCards`, `priceSnapshots`, and `pricingJobs`. Insert the immutable source Blob, upsert normalized catalog rows by `catalogKey`, add snapshots, then change matching jobs from `needs_source_page` to `pricing_pending`.

Expose `commitStagedCatalogRows(source, rows)` as the shared transaction boundary so saved-page and XLSX adapters cannot bypass validation or create owned inventory.

- [ ] **Step 5: Verify duplicate source behavior**

Reimporting the same SHA-256 returns `{ status: "unchanged" }` and creates no new rows or snapshots.

- [ ] **Step 6: Run verification and commit**

Run: `npm test && npm run typecheck`

Expected: PASS.

```bash
git add src/lib/priceCatalog/importService.ts src/lib/rapidScan/db.ts tests/price-catalog-import.test.mjs
git commit -m "feat: import complete price pages atomically"
```

---

### Task 7: Unify XLSX imports with the local catalog

**Files:**
- Modify: `src/lib/priceChartingImport.ts`
- Modify: `tests/price-catalog-import.test.mjs`

**Interfaces:**
- Consumes: `PriceCatalogRow`, `commitStagedCatalogRows()`.
- Produces: existing `parseXLSXFile()` plus local catalog commits.

- [ ] **Step 1: Add a failing adapter test**

Create a minimal in-memory workbook with one row and assert that `parseXLSXFile()` maps `ungraded_price`, `grade9_price`, and `psa10_price` to the same normalized contract used by saved pages.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/price-catalog-import.test.mjs`

Expected: FAIL until the XLSX adapter returns normalized staged rows.

- [ ] **Step 3: Replace inventory insertion with catalog insertion**

`importParsedSets()` must import catalog and price data, not create owned inventory cards. Ownership is created only by scans or explicit library actions.

- [ ] **Step 4: Keep compatibility**

Retain exported names used by `PriceDatabasePage.tsx`, but return an import result with `added`, `updated`, `unchanged`, and `rejected`.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run typecheck`

Expected: PASS.

```bash
git add src/lib/priceChartingImport.ts tests/price-catalog-import.test.mjs
git commit -m "fix: import price files as catalog data"
```

---

### Task 8: Implement catalog lookup and background pricing jobs

**Files:**
- Create: `src/lib/priceCatalog/catalogRepository.ts`
- Create: `src/lib/priceCatalog/pricingQueue.ts`
- Create: `src/lib/priceCatalog/pricingWorker.ts`
- Create: `tests/price-catalog-pricing.test.mjs`
- Modify: `src/lib/yugiohSetCodeIndex.ts`
- Modify: `src/lib/queueProcessor.ts`
- Modify: `src/lib/localCards.ts`

**Interfaces:**
- Produces: `listCatalogSets()`, `findCatalogCard()`, `enqueuePricingForInventory()`, `claimNextPricingJob()`, `runPricingWorker()`, `pricingOutcome()`, `applyPriceMatch()`, `updateCardPricesOnly()`.

- [ ] **Step 1: Write failing pricing policy tests**

```js
test("pricing match updates prices without changing quantity", () => {
  const next = applyPriceMatch(
    { quantity: 3, current_price_raw: null, current_price_psa9: null, current_price_psa10: null },
    { rawUngradedPrice: 2.5, grade9Price: 18, grade10Price: 42 },
  );
  assert.equal(next.quantity, 3);
  assert.equal(next.current_price_raw, 2.5);
  assert.equal(next.current_price_psa9, 18);
  assert.equal(next.current_price_psa10, 42);
});

test("missing catalog match becomes needs_source_page", () => {
  assert.equal(pricingOutcome(null).status, "needs_source_page");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/price-catalog-pricing.test.mjs`

Expected: FAIL because pricing modules are missing.

- [ ] **Step 3: Implement repository priority**

`findCatalogCard()` queries imported `catalogCards` by exact key first. `yugiohSetCodeIndex.ts` uses the imported repository first and the bundled `/data/yugioh-setcode-index.json` only as an identity fallback.

- [ ] **Step 4: Enqueue after save**

After `upsertIdentifiedCapture()` succeeds, enqueue one job by unique `inventoryId`. Repeated scans update quantity but do not create duplicate pricing jobs.

- [ ] **Step 5: Implement pricing worker**

Claim `pricing_pending` or stale `pricing_processing` jobs atomically. On match:

1. Add a `priceSnapshots` record.
2. Call `updateCardPricesOnly()` with the three price fields and timestamp.
3. Set inventory `pricing_status` to `priced`.
4. Mark job `priced`.

On no match, set both job and inventory to `needs_source_page`.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS.

```bash
git add src/lib/priceCatalog/catalogRepository.ts src/lib/priceCatalog/pricingQueue.ts src/lib/priceCatalog/pricingWorker.ts tests/price-catalog-pricing.test.mjs src/lib/yugiohSetCodeIndex.ts src/lib/queueProcessor.ts src/lib/localCards.ts
git commit -m "feat: price saved cards in background"
```

---

### Task 9: Convert the Price Database page to local-first saved-page management

**Files:**
- Create: `src/components/price-db/SavedPageImport.tsx`
- Modify: `src/pages/PriceDatabasePage.tsx`
- Modify: `src/components/price-db/SetCardsList.tsx`
- Modify: `src/components/scanner/QueueStatusIndicator.tsx`

**Interfaces:**
- Consumes: import preview/commit services, `listCatalogSets()`, local catalog rows, pricing counts.

- [ ] **Step 1: Add source regression tests**

```js
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Price Database page no longer disables local sets", async () => {
  const source = await read("src/pages/PriceDatabasePage.tsx");
  assert.doesNotMatch(source, /setSets\\(\\[\\]\\)/);
  assert.doesNotMatch(source, /Price DB is disabled in local-first mode/);
  assert.match(source, /SavedPageImport/);
  assert.match(source, /listCatalogSets/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/price-catalog-import.test.mjs`

Expected: FAIL while the page is still disabled.

- [ ] **Step 3: Build import UI**

Accept `.html`, `.htm`, `.zip`, `.mhtml`, `.mht`, and `.webarchive`. Show filename, source URL, set, row count, warnings, and errors before enabling Import. Show added/updated/unchanged/rejected counts afterward.

- [ ] **Step 4: Replace Supabase reads**

`PriceDatabasePage.tsx` and `SetCardsList.tsx` query Dexie through `catalogRepository.ts`. Preserve search and set browsing. Destructive set deletion must require the existing confirmation dialog and delete only the selected local source/catalog records.

- [ ] **Step 5: Add pricing counts**

`QueueStatusIndicator` shows `Waiting for prices`, `Needs source page`, and `Pricing errors` independently of capture counts.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test
npm run typecheck
npm run build
npx eslint src/components/price-db/SavedPageImport.tsx src/pages/PriceDatabasePage.tsx src/components/price-db/SetCardsList.tsx src/components/scanner/QueueStatusIndicator.tsx
```

Expected: PASS.

```bash
git add src/components/price-db/SavedPageImport.tsx src/pages/PriceDatabasePage.tsx src/components/price-db/SetCardsList.tsx src/components/scanner/QueueStatusIndicator.tsx tests/price-catalog-import.test.mjs
git commit -m "feat: manage local PriceCharting pages"
```

---

### Task 10: Resume pricing independently and complete security/endurance verification

**Files:**
- Modify: `src/hooks/use-queue-auto-resume.ts`
- Modify: `src/lib/priceCatalog/pricingWorker.ts`
- Modify: `tests/price-catalog-pricing.test.mjs`
- Modify: `tests/price-catalog-parsers.test.mjs`

**Interfaces:**
- Consumes: capture and pricing stores.
- Produces: independent startup/recovery behavior.

- [ ] **Step 1: Add recovery and inert-HTML tests**

Assert:

- a stale `pricing_processing` lease is reclaimed once;
- an existing `priced` job is not reclaimed;
- imported `<script>` and `<iframe>` content never appears in normalized output;
- a malformed page commits zero source, catalog, or snapshot rows;
- importing a matching page requeues `needs_source_page` jobs.

- [ ] **Step 2: Run and verify failure**

Run: `node --test tests/price-catalog-pricing.test.mjs tests/price-catalog-parsers.test.mjs`

Expected: FAIL until recovery and sanitization assertions are implemented.

- [ ] **Step 3: Resume both workers**

`useQueueAutoResume()` calls `checkAndResumeQueue()` and `checkAndResumePricingQueue()` independently. A paused/error state in one queue does not pause the other.

- [ ] **Step 4: Run complete automated verification**

Run:

```bash
npm ci
npm test
npm run typecheck
npm run build
npx eslint src/lib/priceCatalog src/lib/priceChartingImport.ts src/lib/yugiohSetCodeIndex.ts src/pages/PriceDatabasePage.tsx src/components/price-db
git diff --check
```

Expected: every command PASS.

- [ ] **Step 5: Perform functional acceptance**

1. Import each synthetic container type.
2. Confirm one set with two catalog cards appears.
3. Scan a matching card and confirm it saves before pricing.
4. Confirm raw/ungraded, grade 9, and Grade 10/PSA 10 populate afterward.
5. Scan an unmatched set and confirm `needs_source_page`.
6. Import its saved page and confirm automatic repricing.
7. Reimport the same file and confirm no duplicate snapshot.
8. Import a newer synthetic snapshot and confirm current values update while history remains.
9. Confirm quantity is unchanged by every pricing operation.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-queue-auto-resume.ts src/lib/priceCatalog/pricingWorker.ts tests/price-catalog-pricing.test.mjs tests/price-catalog-parsers.test.mjs
git commit -m "test: verify local PriceCharting workflow"
```
