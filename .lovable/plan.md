## Why cards aren't being pulled up

I traced the Rapid Scan pipeline and there are three concrete bugs that combine to produce "nothing identifies":

### 1. `rapidBasicLookupClient.ts` no longer calls the edge function
The client was reduced to:
```ts
const directYgo = await lookupYugiohByPrintedCode(args.setCode);
if (directYgo) return directYgo;
return { success: false, source: "none", error: "No local/direct lookup match..." };
```
So Pokémon, MTG, and Sports scans have **no lookup path at all**, and every YGO failure returns "none" instead of falling through to the deployed `rapid-basic-card-lookup` edge function (which has YGOPRODeck + Pokémon TCG + Scryfall + PriceCharting logic).

### 2. The YGO "direct" lookup tries to load a file that doesn't exist
`lookupYugiohByPrintedCode` first fetches `/data/yugioh-setcode-index.json`, but `public/data/` doesn't exist — every scan 404s, then falls back to downloading the **entire YGOPRODeck DB** (`cardinfo.php?misc=yes`, ~30MB) on the first scan. That request frequently exceeds the 8s `LOCAL_LOOKUP_TIMEOUT_MS` and throws, so even YGO cards fail.

### 3. Per-code endpoint isn't used
YGOPRODeck supports `cardinfo.php?setcode=MP25-EN318`, which returns one card in <500ms. The current code ignores it and only does the bulk dump.

## Fix

**A. `src/lib/rapidBasicLookupClient.ts`** — restore edge-function call as the primary lookup, keep direct YGO as a fast pre-check.
```text
runRapidBasicLookup():
  1. If setCode matches YGO printed-code shape → try lookupYugiohByPrintedCode (fast path).
     Return only if success === true.
  2. Otherwise / on miss → supabase.functions.invoke("rapid-basic-card-lookup", { body: args })
     and return its response.
```
Use `import { supabase } from "@/integrations/supabase/client"`. Surface a clear error string when both fail.

**B. `src/lib/yugiohDirectLookup.ts`** — replace the bulk path with the per-code endpoint.
```text
lookupYugiohByPrintedCode(code):
  - normalize code
  - try cached in-memory map (Record<setCode, LocalYgoPrint>) first
  - fetch `https://db.ygoprodeck.com/api/v7/cardinfo.php?setcode=${code}` (no-store)
  - on 200, build LocalYgoPrint from data[0], cache it, return responseFromPrint(..., "ygoprodeck")
  - on 400/404 or empty data, return null (NOT an error) so client falls through to edge fn
  - drop /data/yugioh-setcode-index.json fetch entirely (file doesn't exist)
  - drop getRemoteIndex() bulk dump
```

**C. `src/lib/queueProcessor.ts`** — minor: when lookup fails after both paths, keep current error message but also accept lookup responses whose `requiresDisambiguation === true` as a "needs review" state instead of a hard error (so partial matches surface). One-line change in the failure branch.

No DB, edge-function, or UI changes. No new dependencies.

## Verification

1. Build passes.
2. Scan a YGO card with a clear set code → identified via direct YGOPRODeck per-code endpoint, name + price populated.
3. Scan a Pokémon card with a clear `N/NN` fraction → falls through to edge function, identified via Pokémon TCG API.
4. Scan a junk image (no code) → still rejected at the existing identity gate with "No printed set/card code found".
