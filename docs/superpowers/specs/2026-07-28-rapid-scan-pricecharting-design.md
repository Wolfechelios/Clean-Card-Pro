# Rapid Scan and PriceCharting Local Catalog Design

**Repository:** `Wolfechelios/Clean-Card-Pro`  
**Target branch:** `main`  
**Date:** 2026-07-28  
**Status:** Approved design; implementation has not started

## Goal

Repair and redesign Rapid Scan so Clean-Card-Pro captures cards continuously, identifies them locally, saves them to the library immediately, increments quantity for identical cards, and attaches PriceCharting-derived values asynchronously. The workflow should be as close as practical to the useful behavior of the PriceCharting Android scanner without copying proprietary code or a private database.

The first optimized exact resolver is Yu-Gi-Oh. Existing card-category features remain intact, and adapters allow Pokémon, Magic, sports cards, and other categories later.

## Fixed product decisions

- Keep Rapid Scan inside Clean-Card-Pro; do not require a separate terminal service, Ollama, cloud OCR, or Supabase OCR functions.
- Preserve the camera preview, camera selection, iPhone Continuity Camera behavior, manual capture, rotation, zoom, focus, library, card images, retry controls, and all current features.
- Support automatic stable-frame capture and manual rapid capture.
- Allow session selection of game, set, and photographic card profile.
- Treat the selected set/profile as a strong hint; exact OCR evidence can correct a mismatched set.
- Use local OCR and printed card/set identifiers as the primary identification path.
- Save an identified card before pricing completes.
- Increment quantity when an identical card fingerprint is scanned again.
- Preserve one scan-history record and image per physical capture.
- Store PriceCharting raw/ungraded, grade 9, and grade 10 prices.
- Preserve complete user-saved PriceCharting set pages as immutable local source snapshots and parse them into a fast local index.
- Do not automate unauthorized scraping or bypass PriceCharting authentication or access controls. Page collection is user initiated through normal browser save/export behavior.

## Non-goals

- Copying PriceCharting source code, private databases, credentials, tokens, or protected endpoints.
- Reconstructing a byte-identical PriceCharting application.
- Making pricing synchronous with capture.
- Removing or rewriting unrelated Clean-Card-Pro functionality.
- Guaranteeing camera controls that the selected device/browser does not expose.
- Delivering exact local resolvers for every card category in the first implementation pass.

## Chosen architecture

Use a staged, durable, browser-local pipeline:

1. Capture controller
2. Durable capture queue
3. Local region-of-interest OCR worker
4. Game-specific card resolver
5. Atomic library upsert
6. Independent PriceCharting pricing queue

The camera lane never waits for OCR, library writes, or pricing. Every downstream stage consumes durable IndexedDB work and can recover after refresh or crash.

## End-to-end workflow

### Session setup

The Rapid Scan session bar exposes:

- Game
- Set
- Card photographic profile
- Automatic or manual capture mode
- Queue and error counts

The last-used selections persist until changed. Set selection narrows resolution to the smallest candidate index. If an exact printed identifier proves that the selected set is wrong, the resolver corrects it and records the correction in scan history.

### Capture

Automatic mode evaluates consecutive frames for card boundary confidence, stability, sharpness, glare, clipped highlights, and difference from the most recently accepted physical frame. Manual mode captures immediately. Reflective profiles may take a short burst and keep the sharpest, lowest-glare frame.

Before processing, the capture is written to IndexedDB as a Blob. Base64 conversion is excluded from the critical path.

Retained images:

- Untouched original image
- Color-preserved library image
- Deskewed and contrast-enhanced OCR image
- Adapter-specific OCR crops

### Local OCR

Keep one OCR model warm for the session. Process targeted regions when the game adapter knows where identifiers appear.

Normalize common OCR errors:

- `O` versus `0`
- `I`, `l`, and `1`
- Missing or doubled spaces
- Broken or missing hyphens
- Unicode dash variants
- Case differences

Start with one persistent worker for Safari/iPhone stability. Enable a second desktop worker only when a benchmark proves higher throughput without unacceptable memory growth.

### Card resolution

The first optimized adapter is Yu-Gi-Oh.

Yu-Gi-Oh resolution order:

1. Normalize the printed set/card code.
2. Perform an exact lookup in the selected set index.
3. If necessary, query the game-wide local index.
4. Confirm with card name, number, edition, language, rarity, or variant evidence when available.
5. Continue automatically only when the high-confidence policy passes.
6. Send uncertain results to review without blocking later captures.

The adapter contract allows future Pokémon, Magic, sports, and other resolvers without changing queue, inventory, or pricing layers.

### Immediate library save

After high-confidence identification, save or update inventory in one atomic transaction.

Identity fingerprint:

`game + language + printed set/card code + edition + variant/rarity`

An identical fingerprint increments quantity. Different editions, languages, alternate art, foil/rarity variants, graded copies, or meaningfully different variants remain separate.

Every physical capture writes a separate scan event containing timestamp, images, session selections, OCR evidence, matched identity, confidence, create/increment action, pricing status, and any selected-set correction.

Pricing status begins as `pending`; inventory becomes visible immediately.

### Background pricing

Pricing jobs run independently. They resolve imported PriceCharting records using stable identifiers such as the normalized fingerprint, PriceCharting product ID when available, and product/source URL.

Required normalized fields:

- `card_name`
- `card_number`
- `set_name`
- `raw_ungraded_price`
- `grade_9_price`
- `grade_10_price`
- `source_url`
- `price_date`

Missing prices are `null`, never zero.

When a required set page is missing, the saved card receives `needs_source_page`. Importing the page later automatically retries matching pricing jobs.

## PriceCharting page snapshots and imports

### Source containers

The user saves a complete PriceCharting set page through the browser and imports it. Planned containers:

- HTML plus assets packaged as ZIP
- Chromium MHTML
- Safari Web Archive
- Existing HTML, JSON, and CSV imports where relevant

### Raw preservation

Store the original file unchanged as a Blob with source URL when available, timestamp, SHA-256 hash, parser version, set/game identity, and import counts. Newer snapshots never delete older snapshots.

### Parsing transaction

1. Decode the saved-page container.
2. Parse product rows into isolated staging data.
3. Extract card name, number, set, product URL/ID, raw/ungraded, grade 9, and grade 10 prices.
4. Validate row counts, required fields, currency parsing, duplicate keys, and page identity.
5. Commit catalog and price snapshots atomically only after validation.
6. Report added, updated, unchanged, skipped, and rejected rows.
7. Requeue matching `needs_source_page` pricing jobs.

Imported HTML never executes in the application origin. Previewing uses an inert or sandboxed renderer.

## IndexedDB data model

### `captureJobs`

Job ID, image Blobs/derived regions, session selections, state, retry count, atomic-claim lease, error stage/message, and timestamps.

### `scanEvents`

Immutable per-capture evidence: scan ID, inventory ID, images, OCR/resolver evidence, session profile, quantity action, price snapshot reference, and timestamps.

### `catalogCards`

Game adapter, fingerprint fields, name, number/code, set, language, edition, variant/rarity, PriceCharting identifiers, and source-page reference.

### `inventoryCards`

Inventory ID, fingerprint, quantity, primary image, identity fields, current raw/ungraded, grade 9 and grade 10 values, price status/timestamp, condition metadata, and protected user edits.

### `pricingJobs`

Job ID, inventory ID, fingerprint/source identifiers, state, retries, missing-page/error reason, and timestamps.

### `priceSnapshots`

Catalog/inventory ID, raw/ungraded, grade 9, grade 10, source-page reference/hash, source URL, and snapshot date.

### `sourcePages`

Immutable complete PriceCharting page files and parser provenance.

### `reviewItems`

Low-confidence or conflicting identifications requiring confirmation.

## Photographic profiles

The profile engine is resolver-independent and can improve existing sports-card capture immediately.

Initial profiles:

- Standard/matte
- Sleeved
- Foil/holographic
- Chrome/Prizm
- Absolute/high-gloss
- Custom

Profiles use only controls exposed by the device/browser, including exposure compensation, focus, torch, white balance, and resolution. Unsupported controls fall back to preprocessing.

Reflective profiles use lower exposure/highlight suppression, glare scoring, multi-frame comparison, stronger OCR contrast, and separate color-preserved/OCR-optimized images.

Set selection may provide a default profile; the user can override it. The selected profile is stored on each scan event.

## Queue state machines

Identification:

`captured -> processing_ocr -> identified -> saved`

Alternative identification outcomes:

- `needs_review`
- `identification_error`

Pricing:

`saved -> pricing_pending -> priced`

Alternative pricing outcomes:

- `needs_source_page`
- `pricing_error`

## Failure handling

- Persist every capture before processing.
- Claim work atomically so two workers cannot process one job.
- Recover stale processing leases after refresh/crash.
- Make identification, library upsert, quantity increment, and pricing idempotent.
- Never delete failed captures automatically.
- Display failed jobs with image, stage, error, and Retry action.
- Never let one failed job pause subsequent captures.
- Treat missing PriceCharting data as `needs_source_page`, not scan failure.
- Validate complete imports before committing rows.
- Check available storage before large page/image imports.
- Keep camera fallback behavior and clear only stale device IDs.

## Rapid Scan interface

Retain the current preview and controls. Add a compact session bar:

`Game | Set | Card profile | Auto/Manual | Queue status`

Status counters:

`Captured | OCR queue | Saved | Needs review | Waiting for prices | Errors`

The interface stays responsive while queues drain. Review and retry actions never stop capture.

## Performance requirements

- Rearm within 300 ms after capture.
- Capture persistence below 150 ms at p95 on the target M3 Pro.
- Accept bursts up to 100 captures/minute without dropped images.
- Target median standard-card OCR plus exact local resolution below one second per card on the target M3 Pro.
- Pricing causes no measurable capture slowdown.
- Initialize OCR models once per session.
- Complete a 250-card endurance session with zero lost captures and zero retry-caused quantity inflation.
- Permit backlog during bursts and drain independently.

These are measurable acceptance gates, not unconditional claims for every camera, browser, lighting setup, or card surface.

## Accuracy requirements

- Require exact set/card-code evidence for automatic Yu-Gi-Oh saving.
- Use selected set, name, number, edition, language, rarity, and variant as verification.
- Include standard, sleeved, foil, holographic, Absolute, and Prizm-style cards in the acceptance corpus.
- Permit zero incorrect automatic saves in the approved high-confidence corpus.
- Route uncertainty to review.
- Measure and report actual corpus accuracy.

## Verification plan

### Unit tests

Printed-code normalization, fingerprints, quantity semantics, price parsing/null handling, profile selection, set-hint fallback, and state transitions.

### Queue and storage tests

Atomic claims, stale lease recovery, retry idempotency, refresh recovery, duplicate-scan versus retry distinction, and storage quotas.

### Import tests

Valid page fixtures, malformed/unrelated pages, duplicate hashes, newer snapshots, missing price columns, and transactional rollback.

### Integration tests

Capture through immediate library save; duplicate quantity increment exactly once; background pricing; missing-page retry after import; review flow.

### Browser and hardware tests

Safari, Chromium, iPhone Continuity Camera, built-in Mac camera fallback, and standard/sleeved/foil/Absolute/Prizm-style cards.

### Regression tests

Preserve live preview, camera selection/Camo filtering, zoom, focus, rotation, manual capture, Rapid Scan rows/images, library behavior, retry controls, existing categories, and pricing features.

## Implementation boundaries

Improve focused scanner/data-layer boundaries rather than rewriting the application. Existing components consume stable services:

- Capture service
- OCR service
- Resolver adapter
- Inventory upsert service
- Pricing service
- Page snapshot importer

No feature may be removed merely to simplify implementation.

## Delivery order

1. Add regression and performance instrumentation.
2. Separate capture persistence from OCR/lookup/pricing.
3. Implement durable states and idempotent inventory upserts.
4. Add set/profile selection and photographic preprocessing.
5. Optimize the Yu-Gi-Oh exact resolver.
6. Implement independent pricing jobs and `needs_source_page`.
7. Implement complete PriceCharting page import/parsing.
8. Run endurance, accuracy, browser, hardware, and regression verification.

The implementation plan will convert this order into test-first, file-specific tasks after final review of this written specification.