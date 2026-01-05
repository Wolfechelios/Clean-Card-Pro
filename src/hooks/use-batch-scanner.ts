import { useState } from "react"
import { createClient } from "@supabase/supabase-js"
import { withRetry } from "@/lib/retry"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type BatchJob = {
  id: string
  file: File
  fileName: string
  preview?: string
  status: "pending" | "processing" | "completed" | "error"
  error?: string
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
        await scanOne(job)
        updateJob(job.id, { status: "completed" })
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

  async function scanOne(job: BatchJob) {
    const path = `cards/${job.id}.jpg`

    await withRetry(() =>
      supabase.storage.from("card-images").upload(path, job.file)
    )

    const signedUrl = await withRetry(async () => {
      const res = await supabase.storage
        .from("card-images")
        .createSignedUrl(path, 86400)
      if (!res.data?.signedUrl) throw new Error("Signed URL failed")
      return res.data.signedUrl
    })

    await withRetry(() =>
      supabase.functions.invoke("analyze-card-full", {
        body: { imageUrl: signedUrl },
      })
    )
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
