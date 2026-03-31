

## Plan: Fix Root Cause of Duplicate Names in Import and Scanning

### Root Cause Analysis

1. **Import column matching is fragile**: The Collx `findColumn()` fuzzy matcher searches for any column containing keywords like "name", "card", "player". If the spreadsheet has unexpected column names, every row can match the same wrong column or fall through to a single hardcoded fallback, producing identical names for all rows.

2. **No pre-insert validation**: Both `ImportExport.tsx` and `ServiceImportExport.tsx` insert cards without checking whether the parsed batch looks sane (e.g., 50+ cards all named "Vic Viper T301").

3. **Scan pipeline has no repeat guard**: The queue processor and single-scan hook will happily save the same card name repeatedly without flagging it.

### Changes

**1. Fix the Collx column resolver (`ServiceImportExport.tsx`)**
- After parsing the file but before inserting, run a **column validation step**: check each resolved column mapping and log which header mapped to which field.
- If `findColumn` resolves `card_name` to a column where >80% of values are identical, reject the mapping and try the next keyword fallback instead.
- Add explicit Collx header mappings for known export formats (Collx uses specific headers like "Player Name", "Card", "Title") so fuzzy matching is a last resort, not the default.

**2. Add pre-insert anomaly check to both import flows**
- In `ServiceImportExport.tsx` `handleFileUpload()` and `ImportExport.tsx` `handleFileUpload()`:
  - After parsing all rows, compute a name frequency map.
  - If any single card name accounts for >40% of rows (minimum 5 rows), show a **blocking confirmation dialog** with the suspicious name and count before inserting.
  - If >90% share the same name, auto-reject the import with an error toast explaining the column mapping likely failed.

**3. Add scan anomaly detector utility (`src/lib/scanAnomalyDetector.ts`)**
- Track consecutive identifications during scan sessions (rapid scan, single scan, binder scan).
- `trackIdentification(name)` returns `{ isAnomaly, consecutiveCount, message }`.
- Thresholds: 3 consecutive = warning toast; 5 consecutive = auto-pause queue with prominent alert.
- `resetSession()` and `getSessionReport()` for batch summary.

**4. Integrate detector into queue processor (`src/lib/queueProcessor.ts`)**
- After each successful identification in `processJob()`, call `trackIdentification()`.
- On anomaly: emit warning toast; at 5+ consecutive, pause the queue automatically.

**5. Integrate detector into single scan (`src/hooks/use-card-scanner.ts`)**
- Track last 2 scan results; if both match, show a toast: "Same card detected twice in a row — check image quality".

**6. Integrate detector into binder scan (`src/components/binder/BinderScan.tsx`)**
- After processing a 9-pocket page, if >50% of cards got the same name, show an alert suggesting rescan.

### Files

| File | Action |
|------|--------|
| `src/lib/scanAnomalyDetector.ts` | New — anomaly tracking utility |
| `src/components/settings/ServiceImportExport.tsx` | Edit — fix Collx column resolver, add pre-insert validation |
| `src/components/collections/ImportExport.tsx` | Edit — add pre-insert validation |
| `src/lib/queueProcessor.ts` | Edit — integrate anomaly detector |
| `src/hooks/use-card-scanner.ts` | Edit — track repeat identifications |
| `src/components/binder/BinderScan.tsx` | Edit — post-scan frequency check |

### What stays unchanged
All existing scanning, pricing, queueing, card recognition, library, history, microscope, foil trainer, and UI functionality remains intact.

