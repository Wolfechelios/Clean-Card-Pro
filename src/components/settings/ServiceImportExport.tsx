/* src/components/settings/ServiceImportExport.tsx */
import React, { useMemo, useState } from 'react'
import type { CardRecord } from '../../types/cards'
import { Button } from '../ui/Button'
import { toast } from '../../utils/toast'
import { useAppStore } from '../../store/useAppStore'
import { uuid } from '../../utils/uuid'

/**
 * RULE: Set and Collection must always be the same value.
 * Service import/export enforces this on import and on any bulk operations.
 */
function enforceSetCollection(card: any): any {
  const set = String(card?.card_set ?? '').trim()
  const col = String(card?.collection_name ?? '').trim()
  const v = (set || col || '').trim()
  return {
    ...card,
    card_set: v,
    collection_name: v,
  }
}

export function ServiceImportExport() {
  const { cards, addCardsLocal, bulkUpdateCardsLocal } = useAppStore()
  const [busy, setBusy] = useState(false)

  const exportJson = useMemo(() => cards ?? [], [cards])

  const download = (data: any, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadJson = () => {
    try {
      download(exportJson, `card-scout-service-export-${new Date().toISOString().slice(0, 10)}.json`)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Export failed')
    }
  }

  const importJson = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) {
        toast.error('Import file must be an array')
        return
      }
      const normalized: CardRecord[] = parsed.map((c: any) => {
        const enforced = enforceSetCollection(c)
        return {
          id: enforced.id || uuid(),
          ...enforced,
          created_at: enforced.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any
      })

      addCardsLocal(normalized)
      toast.success(`Imported ${normalized.length} cards`)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const syncAllSetCollection = () => {
    try {
      const updates = (cards ?? []).map((c) => enforceSetCollection(c)) as CardRecord[]
      bulkUpdateCardsLocal(updates)
      toast.success('Synced Set = Collection for all cards')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Sync failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={downloadJson}>Export (Service JSON)</Button>

        <label className="inline-flex items-center">
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importJson(f)
            }}
          />
          <span className="inline-flex">
            <Button variant="ghost" disabled={busy}>
              {busy ? 'Importing…' : 'Import (Service JSON)'}
            </Button>
          </span>
        </label>

        <Button variant="ghost" onClick={syncAllSetCollection}>
          Sync Set = Collection (All)
        </Button>
      </div>

      <div className="text-xs opacity-60">
        Import + Sync rule: if a card has Set or Collection, both fields will be written as the same value.
      </div>
    </div>
  )
}

export default ServiceImportExport
