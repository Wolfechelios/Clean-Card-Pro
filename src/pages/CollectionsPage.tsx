/* src/pages/CollectionsPage.tsx */
import React, { useMemo, useState } from 'react'
import type { CardRecord } from '../types/cards'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAppStore } from '../store/useAppStore'
import { toast } from '../utils/toast'

/**
 * RULE: Set and Collection must always be the same value.
 * This page provides bulk tools to keep them identical.
 */
function enforceSetCollection(card: CardRecord): CardRecord {
  const s = String((card as any)?.card_set ?? '').trim()
  const c = String((card as any)?.collection_name ?? '').trim()
  const v = (s || c || '').trim()
  return {
    ...card,
    card_set: v,
    collection_name: v,
  } as any
}

export function CollectionsPage() {
  const { cards, bulkUpdateCardsLocal } = useAppStore()
  const [search, setSearch] = useState('')
  const [bulkValue, setBulkValue] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return cards ?? []
    return (cards ?? []).filter((c) => {
      const hay = `${c.card_name || ''} ${c.card_number || ''} ${(c as any).card_set || ''} ${(c as any).collection_name || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [cards, search])

  const groups = useMemo(() => {
    const map = new Map<string, CardRecord[]>()
    for (const c of cards ?? []) {
      const v = String(((c as any).collection_name || (c as any).card_set || '') ?? '').trim() || 'Unassigned'
      if (!map.has(v)) map.set(v, [])
      map.get(v)!.push(c)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [cards])

  const syncAll = () => {
    try {
      const updated = (cards ?? []).map((c) => enforceSetCollection(c))
      bulkUpdateCardsLocal(updated)
      toast.success('Synced Set = Collection for all cards')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Sync failed')
    }
  }

  const bulkAssign = () => {
    const v = bulkValue.trim()
    if (!v) {
      toast.error('Enter a Set/Collection name')
      return
    }
    try {
      const updated = filtered.map((c) => ({
        ...c,
        card_set: v,
        collection_name: v,
        updated_at: new Date().toISOString(),
      })) as any
      bulkUpdateCardsLocal(updated)
      toast.success(`Updated ${updated.length} cards`)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Bulk update failed')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="max-w-md w-full">
          <Input
            label="Search cards"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / number / set / collection"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={syncAll}>Sync Set = Collection (All)</Button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 p-4 bg-white/5 space-y-3">
        <div className="text-sm font-medium">Bulk assign (filtered results)</div>
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="flex-1">
            <Input
              label="Set/Collection name"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              placeholder="e.g. Yugioh - LOB"
            />
          </div>
          <Button onClick={bulkAssign}>Apply to Filtered</Button>
        </div>
        <div className="text-xs opacity-60">
          Rule: this writes the same string to both Set and Collection.
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium">Collections</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {groups.map(([name, list]) => (
            <div key={name} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{name}</div>
                  <div className="text-xs opacity-60">{list.length} cards</div>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {list.slice(0, 6).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm">{c.card_name || 'Unknown'}</div>
                      <div className="text-xs opacity-60 truncate">
                        #{c.card_number || '-'} • Set/Collection: {name}
                      </div>
                    </div>
                    <div className="text-xs opacity-70">{c.quantity ?? 1}x</div>
                  </div>
                ))}
                {list.length > 6 && (
                  <div className="text-xs opacity-60 pt-2">+ {list.length - 6} more…</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default CollectionsPage
