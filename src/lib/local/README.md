# Local-first storage layer

Phase 1 of the plan in `.lovable/plan.md`. This directory owns all
browser-side persistence. UI code must import from the repositories, not
from `db` directly.

```
src/lib/local/
├── db.ts                 # Dexie schema (IndexedDB)
├── images.ts             # OPFS image store (+ IndexedDB fallback)
├── repositories/
│   └── index.ts          # cardsRepo, queueRepo, historyRepo,
│                         # catalogRepo, priceRepo, settingsRepo
└── searchIndex.ts        # Fuse-based fuzzy search
```

## Rules

- No network calls live in this folder. Ever.
- The scan critical path uses `putImage` → `queueRepo.enqueue` →
  `catalogRepo.lookup` → `priceRepo.get` → `cardsRepo.save`.
- Match precedence in `catalogRepo.lookup`:
  1. `(game + setCode + cardNumber)` exact
  2. `(game + setName + cardNumber)` exact
  3. `(game + setCode + name)` exact
  4. Case-insensitive `(game + name)`
- Prices come from `priceRepo` only during scanning. Remote refresh is a
  separate, user-initiated background job.
- Images live in OPFS when available; otherwise stored inline in
  IndexedDB. `getImageURL(id)` returns an object URL that is cached until
  `releaseImageURL(id)` is called.

## Not yet wired

Phase 2 will point `use-card-scanner` and the queue processor at these
repos. Phase 4 adds a one-time migration tool that populates
`cardCatalog` / `priceCatalog` / `scannedCards` from the existing cloud
tables.
