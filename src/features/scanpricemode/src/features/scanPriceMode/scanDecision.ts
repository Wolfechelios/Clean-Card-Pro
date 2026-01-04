import { isScanOnlyMode } from './scanMode.store'

export type ScanDecision =
  | { action: 'ADD_NEW' }
  | { action: 'ADD_COPY' }
  | { action: 'DO_NOTHING' }

export function decideScanAction(
  alreadyOwnedQty: number
): ScanDecision {
  if (isScanOnlyMode()) {
    if (alreadyOwnedQty > 0) {
      return { action: 'DO_NOTHING' }
    }
    return { action: 'DO_NOTHING' }
  }

  // SAVE MODE (existing behavior preserved)
  if (alreadyOwnedQty > 0) {
    return { action: 'ADD_COPY' }
  }

  return { action: 'ADD_NEW' }
}
