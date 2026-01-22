import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertTriangle, Trash2, Download, RefreshCw, Bug, Zap, Server, Scan } from "lucide-react";
import { getCrashLogs, clearCrashLogs, exportCrashLogs, getCrashSummary, type CrashLog } from "@/lib/crashAnalytics";
import { toast } from "sonner";

const typeIcons: Record<string, React.ReactNode> = {
  error: <Bug className="h-4 w-4" />,
  unhandled_rejection: <Zap className="h-4 w-4" />,
  scanner_error: <Scan className="h-4 w-4" />,
  api_error: <Server className="h-4 w-4" />,
  component_error: <AlertTriangle className="h-4 w-4" />,
};

const typeColors: Record<string, string> = {
  error: "bg-destructive text-destructive-foreground",
  unhandled_rejection: "bg-orange-500 text-white",
  scanner_error: "bg-amber-500 text-white",
  api_error: "bg-blue-500 text-white",
  component_error: "bg-purple-500 text-white",
};

export function CrashAnalyticsPanel() {
  const [logs, setLogs] = useState<CrashLog[]>([]);
  const [summary, setSummary] = useState({ total: 0, byType: {} as Record<string, number>, recent: [] as CrashLog[] });

  const refresh = () => {
    setLogs(getCrashLogs());
    setSummary(getCrashSummary());
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleClear = () => {
    clearCrashLogs();
    refresh();
    toast.success("Crash logs cleared");
  };

  const handleExport = () => {
    exportCrashLogs();
    toast.success("Crash logs exported");
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatRelativeTime = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <CardTitle className="text-lg">Crash Analytics</CardTitle>
              <CardDescription>View and analyze app crashes and errors</CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={logs.length === 0}>
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
            <Button variant="destructive" size="sm" onClick={handleClear} disabled={logs.length === 0}>
              <Trash2 className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold">{summary.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          {Object.entries(summary.byType).map(([type, count]) => (
            <div key={type} className="p-3 rounded-lg bg-muted/50 text-center">
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-xs text-muted-foreground capitalize">{type.replace('_', ' ')}</div>
            </div>
          ))}
        </div>

        {/* Logs List */}
        {logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Bug className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No crash logs recorded</p>
            <p className="text-xs mt-1">Errors will appear here when they occur</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <Accordion type="multiple" className="space-y-2">
              {logs.map((log) => (
                <AccordionItem key={log.id} value={log.id} className="border rounded-lg px-3">
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Badge className={`shrink-0 ${typeColors[log.type] || 'bg-gray-500'}`}>
                        <span className="mr-1">{typeIcons[log.type]}</span>
                        {log.type.replace('_', ' ')}
                      </Badge>
                      <span className="truncate text-sm font-medium text-left flex-1">
                        {log.message}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatRelativeTime(log.timestamp)}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4">
                    <div className="space-y-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs mb-1">Time</div>
                        <div>{formatTime(log.timestamp)}</div>
                      </div>
                      
                      {log.route && (
                        <div>
                          <div className="text-muted-foreground text-xs mb-1">Route</div>
                          <div className="font-mono text-xs bg-muted p-1 rounded">{log.route}</div>
                        </div>
                      )}
                      
                      {log.context && Object.keys(log.context).length > 0 && (
                        <div>
                          <div className="text-muted-foreground text-xs mb-1">Context</div>
                          <pre className="font-mono text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(log.context, null, 2)}
                          </pre>
                        </div>
                      )}
                      
                      {log.stack && (
                        <div>
                          <div className="text-muted-foreground text-xs mb-1">Stack Trace</div>
                          <pre className="font-mono text-xs bg-muted p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap break-all">
                            {log.stack}
                          </pre>
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
