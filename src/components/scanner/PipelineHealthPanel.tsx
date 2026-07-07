// src/components/scanner/PipelineHealthPanel.tsx
// Diagnostic overlay that shows live per-stage health of the scan pipeline
// (capture → OCR → identify → price → save) plus an on-demand self-test.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, XCircle, Clock, Copy, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { pipelineTracer, type PipelineEvent, type PipelineStage } from "@/lib/pipelineTracer";
import { runPipelineSelfTest, type SelfTestStep } from "@/lib/pipelineSelfTest";
import { toast } from "sonner";

const STAGES: PipelineStage[] = ["capture", "enqueue", "ocr", "identify", "price", "save"];

function statusColor(s: string | undefined) {
  if (s === "ok") return "bg-emerald-500/80";
  if (s === "fail") return "bg-red-500/80";
  if (s === "timeout") return "bg-amber-500/80";
  if (s === "skip") return "bg-slate-500/40";
  if (s === "start") return "bg-blue-500/60 animate-pulse";
  return "bg-muted/40";
}

export function PipelineHealthPanel() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<PipelineEvent[]>(() => pipelineTracer.recent(200));
  const [selfTest, setSelfTest] = useState<SelfTestStep[] | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const unsub = pipelineTracer.subscribe(() => setEvents(pipelineTracer.recent(200)));
    return unsub;
  }, []);

  const perItem = useMemo(() => {
    const map = new Map<string, Map<PipelineStage, PipelineEvent>>();
    const order: string[] = [];
    for (const e of events) {
      if (!map.has(e.itemId)) {
        map.set(e.itemId, new Map());
        order.push(e.itemId);
      }
      const stageMap = map.get(e.itemId)!;
      const prev = stageMap.get(e.stage);
      // Prefer terminal status over start
      if (!prev || prev.status === "start" || e.ts >= prev.ts) stageMap.set(e.stage, e);
    }
    // newest 20 items
    return order.slice(-20).reverse().map((id) => ({ id, stages: map.get(id)! }));
  }, [events]);

  const agg = useMemo(() => pipelineTracer.aggregate(50), [events]);

  const runTest = useCallback(async () => {
    setRunning(true);
    setSelfTest(null);
    try {
      const res = await runPipelineSelfTest();
      setSelfTest(res);
    } catch (e: any) {
      toast.error(`Self-test crashed: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  }, []);

  const copyDiagnostics = useCallback(async () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      aggregate: agg,
      selfTest,
      recent: pipelineTracer.recent(100),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success("Diagnostics copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable");
    }
  }, [agg, selfTest]);

  if (!open) {
    return (
      <div className="fixed bottom-4 right-[9.5rem] z-50 pointer-events-auto">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/60 backdrop-blur-md border border-border/40 shadow-sm text-xs text-foreground/80 hover:bg-background/80 transition-colors"
          aria-label="Open pipeline diagnostics"
        >
          <Activity className="h-3 w-3 text-primary" />
          <span>Diagnostics</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[26rem] max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-hidden flex flex-col rounded-xl bg-background/85 backdrop-blur-xl border border-border/50 shadow-2xl pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Scan Pipeline Health</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { pipelineTracer.clear(); setSelfTest(null); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Aggregate stage summary */}
        <section>
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Success rate (last 50 items)
          </div>
          <div className="grid grid-cols-6 gap-1">
            {STAGES.map((s) => {
              const b = agg[s];
              const rate = b.total ? Math.round((b.ok / b.total) * 100) : null;
              const tone =
                rate == null
                  ? "text-muted-foreground"
                  : rate >= 90
                  ? "text-emerald-500"
                  : rate >= 60
                  ? "text-amber-500"
                  : "text-red-500";
              return (
                <div key={s} className="rounded-md border border-border/40 p-1.5 text-center">
                  <div className="text-[10px] text-muted-foreground capitalize truncate">{s}</div>
                  <div className={cn("text-sm font-semibold", tone)}>
                    {rate == null ? "—" : `${rate}%`}
                  </div>
                  <div className="text-[9px] text-muted-foreground">{b.total} runs</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Live per-item grid */}
        <section>
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Recent scans
          </div>
          {perItem.length === 0 ? (
            <div className="text-xs text-muted-foreground italic px-1 py-3">
              No pipeline activity yet. Scan a card or run the self-test.
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[5rem_repeat(6,minmax(0,1fr))] gap-1 px-1 text-[9px] text-muted-foreground uppercase">
                <div>Item</div>
                {STAGES.map((s) => (
                  <div key={s} className="text-center truncate">{s}</div>
                ))}
              </div>
              {perItem.map(({ id, stages }) => (
                <div key={id} className="grid grid-cols-[5rem_repeat(6,minmax(0,1fr))] gap-1 items-center">
                  <div className="text-[10px] text-muted-foreground font-mono truncate" title={id}>
                    {id.slice(-6)}
                  </div>
                  {STAGES.map((s) => {
                    const evt = stages.get(s);
                    return (
                      <div
                        key={s}
                        title={
                          evt
                            ? `${s}: ${evt.status}${evt.ms != null ? ` · ${evt.ms}ms` : ""}${
                                evt.error ? `\n${evt.error}` : ""
                              }`
                            : `${s}: no event`
                        }
                        className={cn("h-4 rounded-sm", statusColor(evt?.status))}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Self-test */}
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              End-to-end self-test
            </div>
            <Button size="sm" variant="secondary" onClick={runTest} disabled={running} className="h-7 text-xs">
              <Play className="h-3 w-3 mr-1" />
              {running ? "Running…" : "Run"}
            </Button>
          </div>
          {selfTest ? (
            <div className="space-y-1">
              {selfTest.map((step) => (
                <div
                  key={step.stage}
                  className="flex items-start gap-2 rounded-md border border-border/40 px-2 py-1.5 text-xs"
                >
                  {step.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium capitalize truncate">{step.stage.replace(/-/g, " ")}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                        <Clock className="h-2.5 w-2.5 mr-0.5" />
                        {step.ms}ms
                      </Badge>
                    </div>
                    {step.detail && !step.error && (
                      <div className="text-[11px] text-muted-foreground truncate">{step.detail}</div>
                    )}
                    {step.error && (
                      <div className="text-[11px] text-red-500 break-words">{step.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic px-1">
              Click Run to probe OCR, identify, pricing, auth, and backend read.
            </div>
          )}
        </section>
      </div>

      <div className="border-t border-border/40 px-3 py-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={copyDiagnostics} className="h-7 text-xs">
          <Copy className="h-3 w-3 mr-1" />
          Copy diagnostics
        </Button>
      </div>
    </div>
  );
}
