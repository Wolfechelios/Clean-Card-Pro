/* src/components/cards/CardDetailModal.tsx */
import React, { useEffect, useMemo, useState } from 'react'
import type { CardRecord } from '../../types/cards'
import { normalizeString } from '../../utils/normalize'
import { toast } from '../../utils/toast'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'
import { useAppStore } from '../../store/useAppStore'

type Props = {
  isOpen: boolean
  onClose: () => void
  card: CardRecord | null
  onSave?: (updated: CardRecord) => Promise<void> | void
  onDelete?: (id: string) => Promise<void> | void
}

/**
 * RULE: Set and Collection must always be the same value.
 * - Editing either field mirrors the other.
 * - Saving enforces equality.
 */
function syncSetCollection(nextSet: string, nextCollection: string) {
  const s = (nextSet ?? '').trim()
  const c = (nextCollection ?? '').trim()

  if (s && !c) return { set: s, collection: s }
  if (c && !s) return { set: c, collection: c }

  // If both exist but differ, prefer the most recently edited at call-site.
  return { set: s, collection: s || c }
}

export function CardDetailModal({ isOpen, onClose, card, onSave, onDelete }: Props) {
  const { updateCardLocal, deleteCardLocal } = useAppStore()

  const [local, setLocal] = useState<CardRecord | null>(card)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setLocal(card)
  }, [card])

  const canEdit = useMemo(() => !!local, [local])

  const handleChange = (field: keyof CardRecord, value: any) => {
    if (!local) return

    // Enforce Set == Collection live
    if (field === 'card_set' || field === 'collection_name') {
      const nextSet = field === 'card_set' ? String(value ?? '') : String(local.card_set ?? '')
      const nextCollection = field === 'collection_name' ? String(value ?? '') : String(local.collection_name ?? '')
      const synced = syncSetCollection(nextSet, nextCollection)
      setLocal({
        ...local,
        card_set: synced.set,
        collection_name: synced.collection,
      })
      return
    }

    setLocal({
      ...local,
      [field]: value,
    })
  }

  const handleSave = async () => {
    if (!local) return
    setSaving(true)
    try {
      // Final enforce before save
      const synced = syncSetCollection(String(local.card_set ?? ''), String(local.collection_name ?? ''))
      const updated: CardRecord = {
        ...local,
        card_set: synced.set,
        collection_name: synced.collection,
      }

      updateCardLocal(updated)
      await onSave?.(updated)
      toast.success('Saved')
      onClose()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!local) return
    setDeleting(true)
    try {
      deleteCardLocal(local.id)
      await onDelete?.(local.id)
      toast.success('Deleted')
      onClose()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  if (!local) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Card Details">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input
            label="Name"
            value={local.card_name || ''}
            onChange={(e) => handleChange('card_name', e.target.value)}
          />
          <Input
            label="Number"
            value={local.card_number || ''}
            onChange={(e) => handleChange('card_number', e.target.value)}
          />

          <Input
            label="Set (mirrors Collection)"
            value={local.card_set || ''}
            onChange={(e) => handleChange('card_set', e.target.value)}
          />
          <Input
            label="Collection (mirrors Set)"
            value={local.collection_name || ''}
            onChange={(e) => handleChange('collection_name', e.target.value)}
          />

          <Input
            label="Rarity"
            value={local.rarity || ''}
            onChange={(e) => handleChange('rarity', e.target.value)}
          />
          <Input
            label="Language"
            value={local.language || ''}
            onChange={(e) => handleChange('language', e.target.value)}
          />

          <Select
            label="Condition"
            value={local.condition || 'NM'}
            options={[
              { label: 'NM', value: 'NM' },
              { label: 'LP', value: 'LP' },
              { label: 'MP', value: 'MP' },
              { label: 'HP', value: 'HP' },
              { label: 'DMG', value: 'DMG' },
            ]}
            onChange={(v) => handleChange('condition', v)}
          />

          <Input
            label="Quantity"
            type="number"
            value={String(local.quantity ?? 1)}
            onChange={(e) => handleChange('quantity', Number(e.target.value || 1))}
          />

          <Input
            label="Grader"
            value={local.grader || ''}
            onChange={(e) => handleChange('grader', e.target.value)}
          />
          <Input
            label="Grade"
            value={local.grade || ''}
            onChange={(e) => handleChange('grade', e.target.value)}
          />

          <Input
            label="Market Price"
            type="number"
            value={String(local.market_price ?? '')}
            onChange={(e) => handleChange('market_price', Number(e.target.value || 0))}
          />
          <Input
            label="Purchase Price"
            type="number"
            value={String(local.purchase_price ?? '')}
            onChange={(e) => handleChange('purchase_price', Number(e.target.value || 0))}
          />

          <Input
            label="Source"
            value={local.source || ''}
            onChange={(e) => handleChange('source', e.target.value)}
          />
          <Input
            label="Notes"
            value={local.notes || ''}
            onChange={(e) => handleChange('notes', e.target.value)}
          />
        </div>

        <Textarea
          label="Long Notes"
          value={local.long_notes || ''}
          onChange={(e) => handleChange('long_notes', e.target.value)}
          rows={5}
        />

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>

          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>

          <Button onClick={handleSave} disabled={!canEdit || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default CardDetailModal
