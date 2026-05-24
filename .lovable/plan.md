## Goal
Make the Vintage Audit tab faster to triage by adding multi-select + bulk action buttons, instead of clicking "Mark Alpha/Beta" one card at a time.

## UX changes (`src/components/bulk/VintageAuditTab.tsx`)

1. **Per-card checkbox** in the top-left of each candidate tile (using existing `Checkbox` from `components/ui/checkbox`).
2. **Selection toolbar** that appears above the grid whenever ≥1 card is selected, showing:
   - "X selected" count
   - **Select all visible** / **Clear selection** toggles
   - Bulk action buttons (context-aware based on the active game filter):
     - MTG filter: `Mark all as Alpha (1993)`, `Mark all as Beta (1993)`, `Mark all as Unlimited (1993)`
     - Pokémon filter: `Mark all as 1st Edition`, `Mark all as Shadowless`
     - Yu-Gi-Oh filter: `Mark all as 1st Edition`
     - All games / Sports: `Confirm vintage` (writes the per-card `guess` into `edition` and `year` if present)
   - **Dismiss selected** — sets a flag so they stop appearing in future audits (see "Dismiss" below).
3. **"Select all high-confidence (≥70%)"** quick chip for one-click batch confirms.
4. Keep the existing single-card buttons for fine-grained control.

## Bulk write behavior

- Reuse the existing `cards` table update path. Replace the single-card `markMutation` with a `bulkMarkMutation` that takes `{ ids: string[], edition: string, year?: number }` and runs `supabase.from("cards").update(update).in("id", ids)` in one round-trip.
- Toast shows `Marked N cards as <edition>`.
- On success: clear selection, invalidate `["vintage-audit"]`.

## Dismiss (optional, recommended)

To let users hide false positives without editing them:
- Add a lightweight `audit_dismissed_at timestamptz` column to `cards` via migration.
- Audit edge function (`supabase/functions/audit-alpha-beta/index.ts`) filters out rows where `audit_dismissed_at is not null`.
- "Dismiss selected" sets that column to `now()` for the selected ids.

If you'd rather skip the schema change for now, we can drop the Dismiss button and only ship select + bulk-mark.

## Out of scope

- No changes to scoring logic.
- No changes to other audit/bulk tabs.

## Files touched

- `src/components/bulk/VintageAuditTab.tsx` — selection state, toolbar, checkboxes, bulk mutation.
- (Optional) `supabase/functions/audit-alpha-beta/index.ts` + migration — only if you want the Dismiss feature.

## Question before I build

Do you want the **Dismiss** action (requires a small DB column add), or just **select + bulk mark** for now?
