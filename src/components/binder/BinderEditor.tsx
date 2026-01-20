/* src/components/binder/BinderEditor.tsx */
import React, { useMemo, useState } from 'react'
import type { Tables } from '@/integrations/supabase/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

type CardRecord = Tables<'cards'> & { quantity?: number }
type Props = {
  binderName: string
  cards: CardRecord[]
  onClose: () => void
  onUpdateCard?: (card: CardRecord) => void
  onBulkUpdateCards?: (cards: CardRecord[]) => void
}

/**
 * RULE: Set and Collection must always be the same value.
 * For binders, both should match binderName (collection name).
 */
export function BinderEditor({ binderName, cards, onClose, onUpdateCard, onBulkUpdateCards }: Props) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return cards
    return cards.filter((c) => {
      const hay = `${c.card_name || ''} ${c.card_number || ''} ${c.card_set || ''} ${c.collection_name || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [cards, search])

  const enforceBinderSetCollection = async () => {
    try {
      const updates = cards.map((c) => ({
        ...c,
        card_set: binderName,
        collection_name: binderName,
      }))
      onBulkUpdateCards?.(updates)
      toast.success('Binder cards synced: Set = Collection')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to sync binder cards')
    }
  }

  const updateOne = (card: CardRecord) => {
    const updated: CardRecord = {
      ...card,
      card_set: binderName,
      collection_name: binderName,
    }
    onUpdateCard?.(updated)
    toast.success('Updated')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="max-w-md">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a card..."
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={enforceBinderSetCollection}>Sync Set = Collection</Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs opacity-70 bg-white/5">
          <div className="col-span-6">Card</div>
          <div className="col-span-2">#</div>
          <div className="col-span-2">Qty</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {filtered.map((c) => (
          <div key={c.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-white/10 items-center">
            <div className="col-span-6">
              <div className="font-medium">{c.card_name || 'Unknown'}</div>
              <div className="text-xs opacity-60">
                Set/Collection: <span className="opacity-90">{binderName}</span>
              </div>
            </div>
            <div className="col-span-2 text-sm opacity-80">{c.card_number || '-'}</div>
            <div className="col-span-2 text-sm opacity-80">{c.quantity ?? 1}</div>
            <div className="col-span-2 flex justify-end">
              <Button size="sm" onClick={() => updateOne(c)}>
                Force Sync
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default BinderEditor
