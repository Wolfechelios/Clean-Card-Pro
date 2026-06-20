# Rapid Scan Overwrite Notes

This overwrite preserves the existing app and replaces the rapid-scan hot path with a staged engine upgrade.

## Added

- `src/lib/rapidScan/types.ts`
- `src/lib/rapidScan/context.ts`
- `src/lib/rapidScan/quality.ts`
- `src/lib/rapidScan/duplicateGuard.ts`
- `src/lib/rapidScan/fusion.ts`
- `src/lib/rapidScan/intake.ts`
- `src/lib/rapidScan/index.ts`
- `standalone/rapidscan-engine/README.md`

## Upgraded

- `src/lib/idbQueue.ts`
- `src/lib/queueProcessor.ts`
- `src/components/scanner/RapidScanCamera.tsx`

## What changed

1. Every rapid scan capture now gets a session id and immutable sequence number at intake.
2. Queue records now persist stage metadata, quality metrics, and fast duplicate hashes.
3. The processor now performs a preprocess stage before recognition.
4. Duplicate captures are rejected early using a rolling hash window.
5. Final confidence is fused from recognition confidence, OCR confidence, quality score, and session context.
6. Session context is updated from recent accepted scans to bias later matches.

## Important

This is a superset overwrite. Existing screens and flows remain intact.
