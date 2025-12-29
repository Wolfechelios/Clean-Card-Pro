/* src/components/collections/ImportExport.tsx */
import React, { useMemo, useState } from 'react'
import type { CardRecord } from '../../types/cards'
import { Button } from '../ui/Button'
import { toast } from '../../utils/toast'
import { useAppStore } from '../../store/useAppStore'
import { uuid } from '../../utils/uuid'

/**
 * RULE: Set and Collection must always be the same value.
 * During import, if either exists, set both to the same final string.
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

export function ImportExport() {
  const { cards, addCardsLocal } = useAppStore()
  const [importing, setImporting] = useState(false)

  const exportData = useMemo(() => {
    return cards ?? []
  }, [cards])

  const downloadJson = () => {
    try {
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `card-scout-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Export failed')
    }
  }

  const onImportFile = async (file: File) => {
    setImporting(true)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)

      if (!Array.isArray(parsed)) {
        toast.error('Import file must be an array of cards')
        return
      }

      const normalized: CardRecord[] = parsed.map((c: any) => {
        const enforced = enforceSetCollection(c)
        return {
          id: enforced.id || uuid(),
          ...enforced,
          updated_at: new Date().toISOString(),
          created_at: enforced.created_at || new Date().toISOString(),
        } as any
      })

      addCardsLocal(normalized)
      toast.success(`Imported ${normalized.length} cards`)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={downloadJson}>Export JSON</Button>

        <label className="inline-flex items-center">
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImportFile(f)
            }}
          />
          <span className="inline-flex">
            <Button variant="ghost" disabled={importing}>
              {importing ? 'Importing…' : 'Import JSON'}
            </Button>
          </span>
        </label>
      </div>

      <div className="text-xs opacity-60">
        Import rule: if a card has Set or Collection, both will be saved as the same value.
      </div>
    </div>
  )
}

export default ImportExport
