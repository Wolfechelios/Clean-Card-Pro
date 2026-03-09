import { useState } from "react"
import { supabase } from "@/integrations/supabase/client"
import { withRetry } from "@/lib/retry"
import { hybridIdentifyCard } from "@/lib/hybridCardIdentify"

export type BatchJob = {
  id: string
  file: File
  fileName: string
  preview?: string
  status: "pending" | "processing" | "completed" | "error"
  error?: string
  source?: "local" | "cloud" | "gpu" | "orin" // Track which inference engine was used
}

export function useBatchScanner() {
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const [running, setRunning] = useState(false)

  function addFiles(files: File[]) {
    if (!files || files.length === 0) return
    const newJobs: BatchJob[] = files.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      fileName: f.name,
      preview: URL.createObjectURL(f),
      status: "pending",
    }))
    setJobs((prev) => [...prev, ...newJobs])
  }

  async function start() {
    if (running) return
    setRunning(true)

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]
      if (job.status !== "pending") continue

      updateJob(job.id, { status: "processing" })

      try {
        const { source } = await scanOne(job)
        updateJob(job.id, { status: "completed", source })
        await sleep(700)
      } catch (err: any) {
        const msg = String(err?.message ?? err)
        updateJob(job.id, { status: "error", error: msg })

        if (/429|rate limit/i.test(msg)) {
          await sleep(4000)
        } else {
          await sleep(1000)
        }
      }
    }

    setRunning(false)
  }

  async function scanOne(job: BatchJob): Promise<{ source: "local" | "cloud" | "gpu" | "orin" }> {
    const path = `cards/${job.id}.jpg`

    await withRetry(() =>
      supabase.storage.from("card-images").upload(path, job.file)
    )

    const { data: publicUrlData } = supabase.storage
      .from("card-images")
      .getPublicUrl(path)
    const signedUrl = publicUrlData.publicUrl

    // Use hybrid routing for card identification
    const result = await hybridIdentifyCard(signedUrl, {
      cloudFunction: "analyze-card-full",
      skipOfflineGuard: true, // Batch scanner handles its own retry logic
    })

    return { source: result.source }
  }

  function updateJob(id: string, patch: Partial<BatchJob>) {
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, ...patch } : j))
    )
  }

  return { jobs, addFiles, start, running }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
