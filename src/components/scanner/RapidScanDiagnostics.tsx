import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bug, CheckCircle2, ChevronDown, ChevronUp, Clipboard, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQueueProcessor } from "@/lib/queueProcessor";
import { toast } from "sonner";

type FailureStage = "capture" | "vision" | "lookup" | "pricing" | "auth" | "upload" | "database" | "queue" | "unknown";

type DiagnosticEntry = {
  id: string;
  itemId?: string;
  at: number;
  stage: FailureStage;
  message: string;
  suggestion: string;
};

const STORAGE_KEY = "rapid-scan-diagnostics-v1";
const MAX_ENTRIES = 50;

function classify(message: string): Pick<DiagnosticEntry, "stage" | "suggestion"> {
  const text = message.toLowerCase();
  if (/camera|mediastream|getusermedia|permission|notallowed|notreadable|track|canvas|captured image|frame/.test(text)) {
    return { stage: "capture", suggestion: "Check camera permission, close other camera apps, reselect the camera, and capture a sharp full-card image." };
  }
  if (/ocr|vision|onnx|paddle|model|confidence|unknown card|image could not be encoded/.test(text)) {
    return { stage: "vision", suggestion: "Improve lighting and focus, fill the guide with one card, select the correct game, then retry the failed item." };
  }
  if (/identify|identification|rapid-card-identify|card lookup|lookup|function.*identify/.test(text)) {
    return { stage: "lookup", suggestion: "The card lookup service failed or returned no confident match. Verify internet access, Supabase function deployment, and the selected game." };
  }
  if (/price|pricing|fetch-card-prices|market|no current price|price match/.test(text)) {
    return { stage: "pricing", suggestion: "The card was identified but the pricing service failed or found no exact set/number match. Retry pricing and verify the pricing function is deployed." };
  }
  if (/signed out|auth|unauthorized|jwt|session|login/.test(text)) {
    return { stage: "auth", suggestion: "Sign out and back in. Save Mode requires a valid session; Price Mode can be used without saving." };
  }
  if (/upload|storage|bucket|public url|card-images/.test(text)) {
    return { stage: "upload", suggestion: "Check the card-images storage bucket, upload policy, connection, and available storage." };
  }
  if (/database|insert|row level|rls|could not be added|could not be saved|cards table/.test(text)) {
    return { stage: "database", suggestion: "The result was identified but could not be saved. Check login, cards-table permissions, and database connectivity." };
  }
  if (/rate limit|429|queue|buffer|anomaly|worker|timeout/.test(text)) {
    return { stage: "queue", suggestion: "Reduce workers to 1–2, wait for the service limit to clear, then retry failed scans." };
  }
  return { stage: "unknown", suggestion: "Copy this report for diagnosis. Retry once after confirming internet access and that the app is fully updated." };
}

function loadEntries(): DiagnosticEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: DiagnosticEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES))); } catch {}
}

function stageLabel(stage: FailureStage) {
  return ({ capture: "Camera/Capture", vision: "Vision/OCR", lookup: "Card Lookup", pricing: "Pricing", auth: "Authentication", upload: "Image Upload", database: "Database Save", queue: "Queue/Service", unknown: "Unknown" } as const)[stage];
}

export function RapidScanDiagnostics() {
  const queue = useQueueProcessor();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DiagnosticEntry[]>(loadEntries);

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; error?: string }>).detail || {};
      const message = detail.error || "Rapid Scan failed without an error message";
      const classification = classify(message);
      const entry: DiagnosticEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        itemId: detail.id,
        at: Date.now(),
        message,
        ...classification,
      };
      setEntries((previous) => {
        const next = [entry, ...previous].slice(0, MAX_ENTRIES);
        saveEntries(next);
        return next;
      });
      setOpen(true);
    };
    window.addEventListener("rapid-scan-job-error", onError);
    return () => window.removeEventListener("rapid-scan-job-error", onError);
  }, []);

  const failedQueueItems = useMemo(() => queue.queueMeta.filter((item) => item.status === "error"), [queue.queueMeta]);
  const visible = location.pathname === "/scan" || queue.errorCount > 0 || entries.length > 0;
  if (!visible) return null;

  const report = JSON.stringify({
    generatedAt: new Date().toISOString(),
    online: navigator.onLine,
    browser: navigator.userAgent,
    queue: {
      running: queue.isRunning,
      paused: queue.isPaused,
      queued: queue.queueCount,
      processed: queue.processedCount,
      errors: queue.errorCount,
      currentItem: queue.currentItem,
      failedItems: failedQueueItems.map((item) => ({ id: item.id, error: item.error, createdAt: item.createdAt })),
    },
    failures: entries,
  }, null, 2);

  const clear = () => {
    setEntries([]);
    saveEntries([]);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[90] w-[min(94vw,430px)]">
      <div className="overflow-hidden rounded-xl border bg-background/95 shadow-2xl backdrop-blur">
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 p-3 text-left">
          <div className="flex min-w-0 items-center gap-2">
            {entries.length || failedQueueItems.length ? <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold"><Bug className="h-4 w-4" /> Rapid Scan Debug</div>
              <div className="truncate text-xs text-muted-foreground">
                {entries.length ? `${entries.length} recorded failure${entries.length === 1 ? "" : "s"}` : "No recorded pipeline failures"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {entries.length > 0 && <Badge variant="destructive">{entries.length}</Badge>}
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </div>
        </button>

        {open && (
          <div className="max-h-[65vh] space-y-3 overflow-auto border-t p-3">
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded border p-2"><div className="font-semibold">{queue.queueCount}</div><div className="text-muted-foreground">Queued</div></div>
              <div className="rounded border p-2"><div className="font-semibold">{queue.processedCount}</div><div className="text-muted-foreground">Done</div></div>
              <div className="rounded border p-2"><div className="font-semibold text-destructive">{queue.errorCount}</div><div className="text-muted-foreground">Failed</div></div>
              <div className="rounded border p-2"><div className="font-semibold">{navigator.onLine ? "Online" : "Offline"}</div><div className="text-muted-foreground">Network</div></div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={async () => {
                await navigator.clipboard.writeText(report);
                toast.success("Rapid Scan debug report copied");
              }}><Clipboard className="mr-2 h-4 w-4" />Copy Report</Button>
              <Button size="sm" variant="outline" onClick={clear} disabled={!entries.length}><Trash2 className="h-4 w-4" /></Button>
            </div>

            {!entries.length && !failedQueueItems.length ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">The capture, lookup, pricing, and save pipeline has not reported a failure in this browser.</div>
            ) : (
              <div className="space-y-2">
                {entries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="outline">{stageLabel(entry.stage)}</Badge>
                      <span className="text-[11px] text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
                    </div>
                    <div className="break-words text-sm font-medium">{entry.message}</div>
                    {entry.itemId && <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Job: {entry.itemId}</div>}
                    <div className="mt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Correction:</span> {entry.suggestion}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
