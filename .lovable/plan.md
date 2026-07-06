
# Local-First Migration Plan

Goal: the scanner and everyday app usage never touch Supabase. Supabase remains only long enough to migrate existing cloud data into the browser, then all remaining calls are removed.

## Phase 1 — Local storage foundation

Add a Dexie-based IndexedDB layer plus an OPFS image store. No feature changes yet.

- New `src/lib/local/db.ts` — Dexie schema with stores:
  `scannedCards`, `scanQueue`, `scanHistory`, `cardCatalog`, `priceCatalog`, `settings`, `imageMetadata`, `syncQueue`.
- New `src/lib/local/images.ts` — OPFS helpers: `putImage(blob) → imageId`, `getImageURL(id)`, `deleteImage(id)`, thumbnail generation, quota handling, fallback to IndexedDB blob when OPFS unavailable.
- New `src/lib/local/repositories/` — thin repos: `cardsRepo`, `catalogRepo`, `priceRepo`, `queueRepo`, `historyRepo`, `settingsRepo`. Every UI component talks to a repo, never to the DB directly.
- New `src/lib/local/searchIndex.ts` — in-memory Fuse/trigram index over `cardCatalog` + `scannedCards`; rebuild on load and on writes.

## Phase 2 — Rewire the Rapid Scan critical path

Only the scan pipeline in this phase. Camera UI stays untouched.

```text
Camera → capture blob
     → OPFS putImage → imageId
     → queueRepo.enqueue({imageId})
     → local OCR (existing glmOcr / tesseract, no network)
     → catalogRepo.lookup(setCode, cardNumber, name)   // exact match first
     → priceRepo.lookup(cardKey)                        // local cache only
     → cardsRepo.save(result)
     → UI displays result
```

- Replace every `supabase.*` call inside: `use-card-scanner.ts`, `queueProcessor.ts`, rapid-scan hooks/components, `enhancedCardIdentify.ts` (scan path only), image upload helpers.
- Queue must persist across refresh (already in IndexedDB via Dexie) and resume on app load.
- Remove `supabase.auth` gating from the scanner — scanning works signed-out.
- Guarantee: no `await` on a network call before the result renders.

## Phase 3 — Rewire the rest of the app to repos

Point every collection/list/detail/edit/delete/bulk screen at the local repos:
Collections, Card Detail, Value Prediction, Sets, Recent Scans, Bulk Rarity/Reidentify/Image lookup, Import Cleaner, Sell Assist, Visual Search, Price Hub, Graded Scan, Image Backfill, Settings.

Features that require a remote service (Perplexity image search, Gemini vision fallback, PSA10 refresh, price refresh) become **optional background jobs** invoked from Settings, not part of any scan or list-render path. They are disabled by default when Supabase is removed.

## Phase 4 — One-time migration tool

New page `src/pages/MigrateFromCloud.tsx` (Settings → "Import existing cloud collection"):

1. Sign in to Supabase (last time it's needed).
2. Paginated fetch of `cards`, `saved_filters`, `price_cache`, `graded_pricing_cache`, `user_api_keys`, `profiles` for the current user.
3. Download each `card-images` object → OPFS.
4. Write into IndexedDB via repos.
5. Verification report: cloud count vs local count, missing images, size on disk.
6. Button "Mark migration complete" — sets `settings.migrationComplete = true`.

Until `migrationComplete` is true, Supabase client is still bundled but only reachable from this page.

## Phase 5 — Delete Supabase

Once migration is verified:

- Delete `src/integrations/supabase/` (client + generated types).
- Delete `supabase/` (edge functions + config).
- Remove `@supabase/*` deps from `package.json`, drop `VITE_SUPABASE_*` from `.env`.
- Delete auth screens; replace `useAuth` with a stub that returns a local device id (`crypto.randomUUID()` stored in `settings`).
- Delete `src/lib/supabaseFunctionsDisabled.ts` and any remaining call sites.
- Grep for `supabase`, `functions.invoke`, `from(`, `auth.getUser` → must return zero hits outside deleted folders.

## Phase 6 — Local backup / restore (replaces cloud sync)

Settings → Storage panel:

- Export Backup → single `.zip` (JSON + images from OPFS).
- Import Backup → restore into IndexedDB + OPFS.
- Clear scan history / failed-scan images / successful-scan images.
- Rebuild search index.
- Storage usage bar (Navigator Storage API).
- Destructive actions require typed confirmation.

## Technical details

- **Deps to add**: `dexie`, `dexie-react-hooks`, `fuse.js`, `jszip`, `idb-keyval` (fallback), `comlink` (worker for OCR).
- **Deps to remove (Phase 5)**: `@supabase/supabase-js`, `@supabase/ssr` if present.
- **Worker**: move OCR + identification into a Web Worker so the camera thread never blocks.
- **Ordering guarantee**: each queue item carries its `imageId`; result is written keyed by `imageId`. Never assign a result to the "current" card.
- **Match precedence in `catalogRepo.lookup`**: `(setCode + cardNumber)` → `(setName + cardNumber)` → `(name + setCode)` → fuzzy name. AI recognition is only consulted if all exact paths fail AND the user enabled remote fallback.
- **Price precedence**: local `priceCatalog` → cached `price_cache` (migrated) → nothing (show "Refresh price" button). No network call during scan.
- **Image lifecycle**: capture → OPFS → thumbnail → after successful save, original may be pruned per Settings. Upload never happens before display.

## Deliverables per phase

Each phase is a separate, releasable step. Phases 1–3 leave Supabase in the tree but unused by scanning; Phase 4 gives users a way to bring their data over; Phase 5 removes Supabase entirely; Phase 6 finalizes local backup UX.

## Out of scope

- No redesign of the camera UI.
- No new cloud provider.
- No changes to pricing math or identification rules already in project memory.
- Multi-device sync (explicitly replaced by manual backup/restore).
