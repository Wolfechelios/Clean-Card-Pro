

## Plan: Fix "Unknown Card" Errors and Token Truncation

### Root Cause
The `rapid-card-identify` edge function has `max_tokens: 200` — far too low for the response JSON. The AI correctly identifies cards but the response gets truncated mid-JSON (visible in logs: every card shows `Parse error:` with valid data cut off at the `alternatives` array). The fallback sets `card_name: 'Unknown Card'`.

The same issue affects the Gemini Direct fallback path (`maxOutputTokens: 200`).

### Fix

**File: `supabase/functions/rapid-card-identify/index.ts`**

| Line | Current | Fix |
|------|---------|-----|
| 181 | `max_tokens: 200` | `max_tokens: 1024` |
| 237 | `maxOutputTokens: 200` | `maxOutputTokens: 1024` |

This single change fixes both:
- "Unknown Card" errors (JSON will parse correctly)
- Missing alternatives (the array won't be truncated)
- Card selection UI will now display properly since alternatives data will actually arrive

### Files to edit

| File | Changes |
|------|---------|
| `supabase/functions/rapid-card-identify/index.ts` | Increase `max_tokens` from 200 to 1024 on both Lovable AI and Gemini Direct paths |

### What stays unchanged
- Enhanced-card-identify (already has sufficient token limits)
- All client-side components (CardIdentificationEditor, alternatives, manual search — already correctly implemented)
- Queue processor, pricing engine, scanner UI

