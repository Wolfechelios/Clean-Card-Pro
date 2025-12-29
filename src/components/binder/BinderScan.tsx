/* src/components/binder/BinderScan.tsx */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CardRecord } from '../../types/cards'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { toast } from '../../utils/toast'
import { useAppStore } from '../../store/useAppStore'
import { uuid } from '../../utils/uuid'

type Props = {
  isOpen: boolean
  onClose: () => void
  defaultBinderName?: string
}

/**
 * RULE: Set and Collection must always be the same value.
 * For binder scanning, both fields are set to binderName.
 */
export function BinderScan({ isOpen, onClose, defaultBinderName }: Props) {
  const { addCardLocal, addCardsLocal } = useAppStore()

  const [binderName, setBinderName] = useState(defaultBinderName || '')
  const [singleName, setSingleName] = useState('')
  const [singleNumber, setSingleNumber] = useState('')
  const [singleQty, setSingleQty] = useState<number>(1)

  const [queue, setQueue] = useState<CardRecord[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setBinderName(defaultBinderName || '')
      setSingleName('')
      setSingleNumber('')
      setSingleQty(1)
      setQueue([])
      setSaving(false)
    }
  }, [isOpen, defaultBinderName])

  const canAdd = useMemo(() => {
    return binderName.trim().length > 0 && singleName.trim().length > 0
  }, [binderName, singleName])

  const addToQueue = () => {
    if (!canAdd) {
      toast.error('Enter binder name and card name')
      return
    }
    const bn = binderName.trim()

    const card: CardRecord = {
      id: uuid(),
      card_name: singleName.trim(),
      card_number: singleNumber.trim(),
      quantity: Number.isFinite(singleQty) ? Math.max(1, singleQty) : 1,
      // enforce Set == Collection
      card_set: bn,
      collection_name: bn,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any

    setQueue((q) => [card, ...q])
    setSingleName('')
    setSingleNumber('')
    setSingleQty(1)
    toast.success('Added to queue')
  }

  const removeFromQueue = (id: string) => {
    setQueue((q) => q.filter((c) => c.id !== id))
  }

  const saveQueue = async () => {
    const bn = binderName.trim()
    if (!bn) {
      toast.error('Binder name required')
      return
    }
    if (!queue.length) {
      toast.error('Queue is empty')
      return
    }

    setSaving(true)
    try {
      // enforce Set == Collection at save time too
      const payload = queue.map((c) => ({
        ...c,
        card_set: bn,
        collection_name: bn,
        updated_at: new Date().toISOString(),
      }))

      addCardsLocal(payload)
      toast.success(`Saved ${payload.length} cards`)
      onClose()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const saveSingleImmediately = async () => {
    if (!canAdd) {
      toast.error('Enter binder name and card name')
      return
    }
    const bn = binderName.trim()
    const card: CardRecord = {
      id: uuid(),
      card_name: singleName.trim(),
      card_number: singleNumber.trim(),
      quantity: Number.isFinite(singleQty) ? Math.max(1, singleQty) : 1,
      card_set: bn,
      collection_name: bn,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any

    try {
      addCardLocal(card)
      toast.success('Saved')
      setSingleName('')
      setSingleNumber('')
      setSingleQty(1)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Binder Scan">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input
            label="Binder / Collection Name"
            value={binderName}
            onChange={(e) => setBinderName(e.target.value)}
            placeholder="e.g. Pokémon Base Set"
          />

          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <div className="opacity-80">Auto rule</div>
            <div className="opacity-60 text-xs">
              Set and Collection are forced to match this binder name.
            </div>
          </div>

          <Input
            label="Card Name"
            value={singleName}
            onChange={(e) => setSingleName(e.target.value)}
            placeholder="e.g. Charizard"
          />
          <Input
            label="Card Number"
            value={singleNumber}
            onChange={(e) => setSingleNumber(e.target.value)}
            placeholder="e.g. 4/102"
          />

          <Input
            label="Quantity"
            type="number"
            value={String(singleQty)}
            onChange={(e) => setSingleQty(parseInt(e.target.value || '1', 10))}
          />
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="ghost" onClick={addToQueue} disabled={!canAdd}>
            Add to Queue
          </Button>
          <Button onClick={saveSingleImmediately} disabled={!canAdd}>
            Save Now
          </Button>
        </div>

        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Queue</div>
            <Button onClick={saveQueue} disabled={!queue.length || saving}>
              {saving ? 'Saving…' : `Save Queue (${queue.length})`}
            </Button>
          </div>

          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs opacity-70 bg-white/5">
              <div className="col-span-6">Card</div>
              <div className="col-span-2">#</div>
              <div className="col-span-2">Qty</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {queue.length === 0 ? (
              <div className="px-3 py-6 text-sm opacity-60">No cards queued yet.</div>
            ) : (
              queue.map((c) => (
                <div key={c.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-white/10 items-center">
                  <div className="col-span-6">
                    <div className="font-medium">{c.card_name || 'Unknown'}</div>
                    <div className="text-xs opacity-60">
                      Set/Collection: <span className="opacity-90">{binderName.trim() || '-'}</span>
                    </div>
                  </div>
                  <div className="col-span-2 text-sm opacity-80">{c.card_number || '-'}</div>
                  <div className="col-span-2 text-sm opacity-80">{c.quantity ?? 1}</div>
                  <div className="col-span-2 flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => removeFromQueue(c.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default BinderScan
