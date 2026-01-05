"use client"

import { useEffect, useRef, useState } from "react"
import { createClient } from "@supabase/supabase-js"
import { withRetry } from "@/lib/retry"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// HARD LIMIT — do NOT crank this back up unless you add queue telemetry
const CONCURRENT_LIMIT = 2
const RATE_LIMIT_PAUSE_MS = 5000

type ScanJob = {
  id: string
  file: File
  status: "pending" | "processing" | "success" | "error"
  error?: string
}

export default function RapidScanCamera() {
  const [jobs, setJobs] = useState<ScanJob[]>([])
  const [paused, setPaused] = useState(false)
  const activeCount = useRef(0)

  useEffect(() => {
    if (paused) return
    processQueue()
  }, [jobs, paused])

  async function processQueue() {
    if (activeCount.current >= CONCURRENT_LIMIT) return

    const nextJob = jobs.find((j) => j.status === "pending")
    if (!nextJob) return

    activeCount.current++

    updateJob(nextJob.id, { status: "processing" })

    try {
      await scanSingleCard(nextJob)
      updateJob(nextJob.id, { status: "success" })
    } catch (err: any) {
      const msg = String(err?.message ?? err)

      updateJob(nextJob.id, {
        status: "error",
        error: msg,
      })

      if (/429|rate limit|too many/i.test(msg)) {
        setPaused(true)
        setTimeout(() => setPaused(false), RATE_LIMIT_PAUSE_MS)
      }
    } finally {
      activeCount.current--
      setTimeout(processQueue, 300)
    }
  }

  function updateJob(id: string, patch: Partial<ScanJob>) {
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, ...patch } : j))
    )
  }

  async function scanSingleCard(job: ScanJob) {
    const filePath = `cards/${job.id}.jpg`

    // 1️⃣ Upload image
    await withRetry(() =>
      supabase.storage.from("card-images").upload(filePath, job.file, {
        upsert: false,
      })
    )

    // 2️⃣ Signed URL
    const signedUrl = await withRetry(async () => {
      const res = await supabase.storage
        .from("card-images")
        .createSignedUrl(filePath, 60 * 60 * 24)
      if (!res.data?.signedUrl) {
        throw new Error("Failed to create signed URL")
      }
      return res.data.signedUrl
    })

    // 3️⃣ Identify card
    await withRetry(() =>
      supabase.functions.invoke("rapid-card-identify", {
        body: { imageUrl: signedUrl },
      })
    )
  }

  function addFiles(files: FileList | null) {
    if (!files) return

    const newJobs: ScanJob[] = Array.from(files).map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      status: "pending",
    }))

    setJobs((prev) => [...prev, ...newJobs])
  }

  return (
    <div className="p-4 space-y-4">
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => addFiles(e.target.files)}
      />

      {paused && (
        <div className="text-yellow-400 font-semibold">
          Rate limit hit — pausing briefly…
        </div>
      )}

      <ul className="space-y-2">
        {jobs.map((j) => (
          <li key={j.id}>
            {j.status.toUpperCase()}
            {j.error && <span className="text-red-400"> — {j.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
