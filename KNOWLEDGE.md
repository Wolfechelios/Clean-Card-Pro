# Card Scout Pro — System Knowledge File

> Canonical reference for architecture, pipelines, integrations, and development rules.
> All new features **must** integrate into this system without breaking existing functionality.

---

## Table of Contents

1. [App Overview](#1-app-overview)
2. [Scanning Pipeline](#2-scanning-pipeline)
3. [OCR & Card Identification](#3-ocr--card-identification)
4. [Pricing Aggregation](#4-pricing-aggregation)
5. [Collection Tracking](#5-collection-tracking)
6. [Offline Queue System](#6-offline-queue-system)
7. [Mode-Based Architecture](#7-mode-based-architecture)
8. [Database Schema](#8-database-schema)
9. [Security Model](#9-security-model)
10. [Performance Tiering](#10-performance-tiering)
11. [Integration Contracts](#11-integration-contracts)
12. [Development Rules](#12-development-rules)

---

## 1. App Overview

Card Scout Pro scans, identifies, catalogs, and prices trading cards (Pokémon, Yu-Gi-Oh!, MTG, sports). It runs as a PWA with Capacitor-based native wrappers.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui |
| State | Zustand (queue, processes), React Query (data fetching), localStorage (settings) |
| Backend | Supabase (Auth, Postgres, Storage, Edge Functions) |
| OCR | Z.AI GLM-OCR, PaddleOCR (offline), Google Vision |
| AI/Vision | Gemini 2.5 Flash (via Lovable AI), user-provided Gemini key (fallback) |
| Pricing | PriceCharting, eBay Sold, TCGPlayer, SportsCardPro, 130point, CardLadder |
| Offline | IndexedDB (localforage + raw IDB), Service Worker |

### Key Directories

```
src/
├── components/
│   ├── binder/        # Binder Mode (set-order collection view)
│   ├── cards/         # Card detail, modal, predictions
│   ├── collections/   # Collection grid, filters, bulk ops
│   ├── pricing/       # Price chips, consensus panel, calculators
│   ├── scanner/       # RapidScan, USB import, upload, batch queue
│   ├── layout/        # AppShell, NavBar, SideBar
│   └── ui/            # shadcn primitives
├── hooks/             # Custom React hooks
├── lib/
│   ├── pricing/       # Consensus engine, adapters, types
│   ├── foilTrainer/   # Foil/rarity correction feedback loop
│   ├── performance/   # Device tiering, memory config, pipeline guards
│   ├── storage/       # Public image URL utilities
│   └── ...            # Queue processor, OCR, image compressor, etc.
├── pages/             # Route-level page components
└── integrations/
    └── supabase/      # Auto-generated client + types (DO NOT EDIT)

supabase/
├── functions/         # Edge functions (one per directory)
├── migrations/        # SQL migrations (read-only)
└── config.toml        # Project config (auto-managed)
```

---

## 2. Scanning Pipeline

### 2.1 Architecture

The scanner uses a **serialized, single-card identification model**. Multi-card binder scanning is explicitly forbidden to prevent identification errors.

```
┌──────────┐   ┌──────────────┐   ┌───────────────┐   ┌──────────────┐
│  Capture  │──▶│ IDB Queue    │──▶│ Hybrid ID     │──▶│ Price Fetch  │
│ (Camera/  │   │ (persistent) │   │ (Cloud/Local)  │   │ (Consensus)  │
│  Upload)  │   └──────────────┘   └───────────────┘   └──────────────┘
└──────────┘                              │                     │
                                          ▼                     ▼
                                   ┌──────────────┐     ┌──────────────┐
                                   │ Supabase DB  │     │ Recent Scans │
                                   │ (cards table)│     │ (localforage)│
                                   └──────────────┘     └──────────────┘
```

### 2.2 Scanner Tabs

| Tab | Component | Purpose |
|-----|-----------|---------|
| Rapid Scan | `RapidScanCamera` | Live camera with viewfinder-first UI, 80px capture button, overlay controls |
| USB | `USBBulkImport` | Bulk photo import from device storage |
| Upload | `UploadTab` | Drag-and-drop / file picker |

### 2.3 Capture Pipeline

1. **Frame Capture** — Camera stream → high-quality JPEG (0.95 quality, image smoothing disabled)
2. **Image Compression** — `imageCompressor.ts` resizes for network efficiency
3. **Queue Insert** — Blob + metadata written to IndexedDB via `idbQueue.ts`
4. **Queue Processing** — `queueProcessor.ts` picks up items, routes through hybrid identify
5. **Result Storage** — Identified card inserted via `insertCardDual()` (Supabase + localforage)

### 2.4 Camera System

- **Progressive fallback**: 4K → FHD → HD → facingMode → any camera
- **Rear-only enforcement**: Front cameras filtered via resolution heuristics
- **Lens classification**: Wide/UltraWide/Telephoto/Macro via labels, focal length, probing
- **Hardware optimization**: Max sharpening, min ISO, 4:3 aspect, contrast 70%, saturation 60%

### 2.5 Scan Modes

| Mode | Behavior |
|------|----------|
| `SAVE` | Identify → price → save to collection |
| `SCAN_ONLY` | Identify → price → display only (no DB write) |
| `REMOVE` | Identify → find in collection → delete matching card |

Modes are persisted in `localStorage` via `use-scanner-settings.ts`.

---

## 3. OCR & Card Identification

### 3.1 Three-Tier Hybrid Pipeline

```
Tier 1: Local Fast-Pass OCR
  └─ PaddleOCR (WASM) for instant text extraction
       │
       ▼
Tier 2: Z.AI OCR (Edge Function: zai-ocr)
  └─ Focused extraction on cropped ROIs (title, collector number)
  └─ Model: glm-ocr via ZAI_API_KEY
       │
       ▼
Tier 3: Multimodal AI Reasoning (Edge Functions: rapid-card-identify, analyze-card-full)
  └─ Gemini 2.5 Flash via Lovable AI (LOVABLE_API_KEY)
  └─ Fallback: User's GEMINI_API_KEY (validated, not placeholder)
  └─ Single-call: OCR + identification + condition assessment
```

### 3.2 Hybrid Routing (`hybridCardIdentify.ts`)

```typescript
interface HybridIdentifyResult {
  success: boolean;
  cardData: IdentifiedCardData;
  source: "local" | "cloud";
  error?: string;
}
```

- **Online** → Cloud edge function (`rapid-card-identify`)
- **Offline** → Local LLM (Ollama) with PaddleOCR preprocessing
- Max 1 offline attempt per image to prevent requeue loops

### 3.3 Yu-Gi-Oh! ROI Detection

- **Set Code**: Bottom 18–25% vertical, rightmost 30–40% horizontal. Regex: `\b[A-Z0-9]{2,5}-[A-Z]{0,2}[0-9]{3}\b`
- **1st Edition**: Bottom 35–50% vertical, leftmost 30–40% horizontal. Exact case-sensitive match.
- Missing = "Unlimited" classification

### 3.4 Output Shape

```typescript
interface IdentifiedCardData {
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  edition: string | null;
  game_type: string | null;     // "pokemon" | "yugioh" | "mtg" | "sports"
  sport_type: string | null;    // "baseball" | "basketball" | "football" | etc.
  year: string | null;
  manufacturer: string | null;
  confidence: number;           // 0–100
}
```

---

## 4. Pricing Aggregation

### 4.1 Source Hierarchy

| Priority | Source | Method |
|----------|--------|--------|
| 1 | PriceCharting | Firecrawl scrape of card-specific page |
| 2 | eBay Sold Listings | Firecrawl scrape, extract sold prices |
| 3 | TCGPlayer | API / scrape |
| 4 | SportsCardPro | Firecrawl (sports cards) |
| 5 | 130point / CardLadder | Firecrawl (sports cards) |

### 4.2 Price Tiers

```
PSA 10 > PSA 9 > Raw (NM) > Mid-grade (PSA 6–8) > Lowest verified sale
```

When APIs conflict → **use the median**, not highest or lowest.

### 4.3 Consensus Engine (`src/lib/pricing/consensus.ts`)

- **Algorithm**: Median + IQR + MAD z-scores
- **Anomaly threshold**: MAD z-score > 3.5 or price > 2.5× median
- **Flags**: `NOT_ENOUGH_SOURCES`, `LOW_MATCH_CONFIDENCE`, `OUTLIER_DETECTED`, `HIGH_VARIANCE`
- **Confidence gate**: Blocks automated listing if confidence < 55%
- **Cache**: 4-hour in-memory cache on price_cache table

### 4.4 PSA 10 Pricing

- Primary source: PriceCharting.com card page (Firecrawl scrape)
- Parse exact displayed numeric value — no estimation, rounding, or multipliers
- Returns `null` if PSA 10 price not explicitly displayed
- All artificial markups are stripped from all sources

### 4.5 Local Price Database

- Master data imported from PriceCharting XLSX files → `pc_sets` + `pc_cards` tables
- Matching hierarchy: exact (game + set_id + card_number + variant) → exact minus variant → fuzzy name
- GIN trigram indexes for fast fuzzy matching
- Management UI: CRUD, set merging/splitting, auto `total_cards` sync

### 4.6 Edge Functions

| Function | Purpose |
|----------|---------|
| `fetch-card-prices` | Multi-source price aggregation |
| `get-psa10-price` | Dedicated PSA 10 lookup |
| `update-prices` | Bulk price refresh for collection |
| `graded-card-pricing` | Graded card pricing with multiplier |
| `sports-card-prices` | Sports-specific pricing pipeline |

---

## 5. Collection Tracking

### 5.1 Data Model

Primary table: `cards` (Supabase, RLS enforced per user)

Key fields:
- Identity: `card_name`, `card_set`, `card_number`, `edition`, `finish`, `rarity`
- Pricing: `current_price_raw`, `current_price_psa9`, `current_price_psa10`, `psa10_price`
- Image: `image_url`, `thumbnail_url`, `image_storage_path`, `image_source`
- Metadata: `game_type`, `sport_type`, `year`, `manufacturer`, `player_name`, `team`
- Normalization: `raw_name`, `raw_set`, `raw_number`, `normalized_at`, `normalization_confidence`
- Quantity: `quantity` (default 1, every scan adds a new row — duplicates allowed)

### 5.2 Dual-Write Pattern

```
insertCardDual(card) → Supabase INSERT + localforage upsert
updateCardDual(id, updates) → Supabase UPDATE + localforage upsert
deleteCardDual(id) → Supabase DELETE + localforage delete
```

### 5.3 Set/Collection Enforcement

`enforceSetCollection()` ensures `card_set` and `collection_name` are always synchronized to the same trimmed value.

### 5.4 Binder Mode (`/binder`)

- Visual binder using `pc_cards` as master set list
- 3×3 grid layout, strict set order
- Matching: `card_number + finish + edition` (most granular)
- Owned cards: full-color image + quantity badge
- Missing cards: grey silhouette with card number + name
- Features: completion %, heatmap value glow, near-complete page highlighting
- Page flip: 3D page turn or horizontal slide (togglable)
- Filters: missing only, prices, variants, heatmap mode

### 5.5 Image Storage

- Bucket: `card-images` (public)
- Path: `cards/{game}/{id}.jpg`
- Server-side download via edge functions to avoid CORS
- `toPublicImageUrl()` recovers expired signed URLs to permanent public URLs
- Source priority: Game DB (Scryfall, PokémonTCG, YGOProDeck) → PriceCharting → eBay (last resort)

### 5.6 Valuation Formula

```
Total Value = Σ (card.price × card.quantity)
```

Every scan = new physical card instance. Duplicates are explicitly allowed.

---

## 6. Offline Queue System

### 6.1 IndexedDB Queue (`idbQueue.ts`)

```typescript
type QueueItem = {
  id: string;
  createdAt: number;
  processingStartedAt?: number;
  status: "queued" | "processing" | "success" | "error";
  error?: string;
  blob: Blob;
  mime: string;
  filename: string;
};
```

- Database: `card_scout_pro`, store: `rapid_scan_queue`
- Indexed on `[status, createdAt]` for efficient next-item retrieval
- Persists across page refreshes and app restarts

### 6.2 Queue Processor (`queueProcessor.ts`)

- **Workers**: 1 (strictly single-worker to prevent result collapse)
- **Min delay**: 800ms between jobs
- **Stuck recovery**: Items in `processing` > 5 seconds auto-recovered to `queued`
- **Rate limit backoff**: All workers pause 5s on HTTP 429, jobs re-queued
- **Auto-resume**: `use-queue-auto-resume.ts` silently restarts on app mount
- **Anomaly detection**: Warns at 3 repeats, pauses at 5, hard-stops at 10

### 6.3 Offline Sync (`offlineManager.ts`)

- Supports caching up to 10,000 cards in localforage
- Paginated sync: fetches in batches of 1,000 to bypass Supabase row limits
- Background image preloading for offline viewing
- `syncFromSupabase()`: clears local → upserts all from server

### 6.4 Anomaly Detection (`scanAnomalyDetector.ts`)

| Threshold | Action |
|-----------|--------|
| 3 consecutive identical names | Warning toast |
| 5 consecutive identical names | Auto-pause queue |
| 10 consecutive identical names | Hard stop, mark remaining as errors |
| >40% bulk import same name | User confirmation required |
| >90% bulk import same name | Auto-reject |

Persistent `isPausedByAnomaly` flag in localStorage prevents auto-resume from restarting a broken queue.

---

## 7. Mode-Based Architecture

### 7.1 Scan Modes (Feature Flags)

Managed via `use-scanner-settings.ts`, persisted in `localStorage`:

```typescript
type ScanMode = "SAVE" | "SCAN_ONLY" | "REMOVE";

interface ScannerSettings {
  scanMode: ScanMode;
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number;     // 0–100 confidence
  hapticsOnCapture: boolean;
  flashOnCapture: boolean;
  autoTimerIntervalSeconds: 1 | 1.5 | 2 | 5;
  voiceCaptureEnabled: boolean;
  voiceCaptureKeyword: string;
  manualFocusLock: boolean;
  fullscreenScanMode: boolean;
  autoZoomEnabled: boolean;
  autoCaptureEnabled: boolean;
  batchScanSize: number;
  preferredMicroscopeDeviceId: string;
}
```

### 7.2 Global Process Control

Zustand store (`use-global-process-control.ts`):
- Register/unregister running processes by name
- Broadcast stop signals to all registered processes
- Dashboard "Stop All" button shows active count + spinner
- Processes: bulk re-identify, PSA price update, image backfill, insights, etc.

### 7.3 Device Performance Tiers

Classified by `src/lib/performance/deviceTier.ts`:

| Tier | Criteria | Workers | In-Flight | Job Delay | API Delay |
|------|----------|---------|-----------|-----------|-----------|
| High | ≥8 cores, ≥8GB RAM, non-touch | 6 | 6 | 10ms | 20ms |
| Low | Everything else | 2 | 2 | 50ms+ | 50ms+ |

### 7.4 Navigation System

Single source of truth: `src/lib/navigation.ts`

Sections: Core (Dashboard, Scan, Collections, Binder) → Tools → Insights → Settings

Adding a new page:
1. Create `src/pages/MyPage.tsx`
2. Add lazy import in `App.tsx`
3. Add `<Route>` in `AppRoutes`
4. Add entry in `NAV_SECTIONS` in `navigation.ts`

---

## 8. Database Schema

### 8.1 Core Tables

| Table | Purpose | RLS |
|-------|---------|-----|
| `cards` | User's card collection | `user_id = auth.uid()` |
| `pc_sets` | Master set list (PriceCharting imports) | `user_id = auth.uid()` |
| `pc_cards` | Master card list per set | `user_id = auth.uid()` |
| `price_history` | Historical price snapshots | Joins to `cards.user_id` |
| `price_alerts` | User price alerts | `user_id = auth.uid()` |
| `price_cache` | Shared price cache | `auth.uid() IS NOT NULL` |
| `profiles` | User profile data | `id = auth.uid()` |
| `user_api_keys` | Encrypted third-party API keys | `user_id = auth.uid()` |
| `user_roles` | Admin/moderator/user roles | `has_role()` security definer |
| `scan_sessions` | Scan session metadata | `user_id = auth.uid()` |
| `foil_scan_corrections` | Foil/rarity correction training data | `user_id = auth.uid()` |
| `foil_learning_memory` | Aggregated correction patterns | `user_id = auth.uid()` |
| `graded_pricing_cache` | Graded card pricing cache | `auth.uid() IS NOT NULL` |
| `grader_premiums` | Grade multiplier lookup | Public read, admin write |
| `saved_filters` | User's saved collection filters | `user_id = auth.uid()` |
| `remote_scan_sessions` | Remote phone-to-desktop sessions | `user_id = auth.uid()` |

### 8.2 Key Constraints

- All IDs are UUID (`gen_random_uuid()`)
- `cards.user_id` is NOT a foreign key to `auth.users` (by design)
- `enforceSetCollection()` keeps `card_set` = `collection_name` in sync
- `quantity` defaults to 1
- `image_search_status` defaults to `'missing'`

---

## 9. Security Model

### 9.1 RLS (Row-Level Security)

Every table has RLS enabled. User data is isolated via `auth.uid() = user_id`.

### 9.2 API Key Encryption

- `user_api_keys.key_value` encrypted with AES-256-GCM (Web Crypto API)
- Key derivation: PBKDF2 from service role secret
- CRUD via `manage-api-keys` edge function only
- Frontend only receives masked values

### 9.3 Storage Policies

- `card-images` bucket: ownership-scoped INSERT/UPDATE/DELETE
- Path validation ensures users can only access `cards/{user_id}/*`

### 9.4 SSRF Protection

- `validateUrl.ts` shared utility blocks private IPs, metadata endpoints, local files
- Applied to all edge functions that fetch user-supplied URLs

### 9.5 Rate Limiting

- `rateLimiter.ts` shared utility for edge functions
- Per-user, per-function limits on expensive AI/pricing calls

---

## 10. Performance Tiering

### 10.1 Pipeline Guards (`pipelineGuards.ts`)

- Enforce max in-flight frame count based on device tier
- `canProcessFrame()` / `markFrameStart()` / `markFrameEnd()` gate concurrency

### 10.2 Memory Config (`memoryConfig.ts`)

- Configures buffer sizes, cache limits, and worker counts per tier
- Prevents OOM on low-end devices

### 10.3 React Query Config

```typescript
{
  staleTime: 10_000,      // 10s freshness
  gcTime: 10 * 60_000,    // 10min garbage collection
  refetchOnWindowFocus: false,
  retry: 2
}
```

---

## 11. Integration Contracts

### 11.1 Adding a New Edge Function

1. Create `supabase/functions/<name>/index.ts`
2. Handle CORS (import from `@supabase/supabase-js/cors` or define manually)
3. Validate JWT in code (functions deploy with `verify_jwt = false`)
4. Validate all inputs with Zod
5. Use `validateUrl()` for any user-supplied URLs
6. Apply rate limiting for expensive operations
7. Never execute raw SQL — use typed Supabase client only

### 11.2 Adding a New Page

1. `src/pages/NewPage.tsx` — page component
2. `src/App.tsx` — lazy import + `<Route>` with auth guard
3. `src/lib/navigation.ts` — add to `NAV_SECTIONS`

### 11.3 Adding a New Scanner Feature

1. Integrate into existing `Scanner.tsx` tab system (Rapid / USB / Upload)
2. Use `idbQueue.ts` for any async processing
3. Route identification through `hybridCardIdentify.ts`
4. Save via `insertCardDual()` for dual-write consistency
5. Respect `ScanMode` (SAVE / SCAN_ONLY / REMOVE)
6. Register long-running processes in global process control

### 11.4 Adding a New Price Source

1. Create adapter in `src/lib/pricing/adapters.ts` or `sportsAdapters.ts`
2. Return `PriceQuote[]` conforming to `src/lib/pricing/types.ts`
3. Feed into `computeConsensus()` — consensus engine handles outlier detection
4. Add edge function if server-side scraping needed

---

## 12. Development Rules

### DO

- Use semantic design tokens from `index.css` / `tailwind.config.ts`
- Wrap all async calls in try/catch
- Include loading, error, and empty states for every UI
- Use React Query for data fetching (consolidation priority)
- Keep all pricing logic in `src/lib/pricing/`
- Keep all vision/OCR logic in edge functions or `src/lib/`
- Store types in component-local interfaces or `src/lib/*/types.ts`
- Validate all edge function inputs with Zod
- Test with both high-tier and low-tier device profiles

### DO NOT

- Edit `src/integrations/supabase/client.ts` or `types.ts`
- Edit `.env` (auto-managed)
- Create random new DB tables without approval
- Store private API keys in code (use secrets or encrypted storage)
- Use `find /` or scan entire filesystem
- Guess card identity without evidence
- Mix business logic into UI components
- Add dependencies without explicit need
- Break the serialized single-card scanning model
- Use front-facing cameras

### Quality Checklist

- [ ] Types are correct and complete
- [ ] No console errors
- [ ] No unused imports
- [ ] OCR functions return consistent `IdentifiedCardData` shape
- [ ] Pricing returns unified `PriceQuote` / `PriceConsensus` schema
- [ ] UI is responsive
- [ ] RLS rules remain intact
- [ ] Image pipeline: upload → detect → price → store works end-to-end
- [ ] Code is readable, modular, and extendable
