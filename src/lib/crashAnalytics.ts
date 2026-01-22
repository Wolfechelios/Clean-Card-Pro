/**
 * Crash Analytics - Logs errors to localStorage and provides viewing utilities
 */

export interface CrashLog {
  id: string;
  timestamp: string;
  type: 'error' | 'unhandled_rejection' | 'scanner_error' | 'api_error' | 'component_error';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  route?: string;
  userAgent?: string;
}

const CRASH_LOG_KEY = 'crash_analytics_logs';
const MAX_LOGS = 100;

// Get stored crash logs
export function getCrashLogs(): CrashLog[] {
  try {
    const stored = localStorage.getItem(CRASH_LOG_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save a crash log
export function logCrash(
  type: CrashLog['type'],
  error: Error | string,
  context?: Record<string, unknown>
): CrashLog {
  const log: CrashLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context,
    route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };

  try {
    const logs = getCrashLogs();
    logs.unshift(log);
    // Keep only the most recent logs
    const trimmed = logs.slice(0, MAX_LOGS);
    localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('Failed to save crash log:', e);
  }

  // Also log to console for immediate visibility
  console.error(`[Crash Analytics] ${type}:`, log);
  
  return log;
}

// Clear all crash logs
export function clearCrashLogs(): void {
  localStorage.removeItem(CRASH_LOG_KEY);
}

// Export crash logs as JSON file
export function exportCrashLogs(): void {
  const logs = getCrashLogs();
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `crash-logs-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Scanner-specific error logging
export function logScannerError(
  error: Error | string,
  scannerType: 'rapid' | 'batch' | 'single' | 'binder',
  additionalContext?: Record<string, unknown>
): CrashLog {
  return logCrash('scanner_error', error, {
    scannerType,
    ...additionalContext,
  });
}

// API error logging
export function logApiError(
  error: Error | string,
  endpoint: string,
  additionalContext?: Record<string, unknown>
): CrashLog {
  return logCrash('api_error', error, {
    endpoint,
    ...additionalContext,
  });
}

// Install global error handlers
export function installGlobalErrorHandlers(): void {
  // Handle uncaught errors
  window.addEventListener('error', (event) => {
    logCrash('error', event.error || event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason instanceof Error 
      ? event.reason 
      : new Error(String(event.reason));
    logCrash('unhandled_rejection', error, {
      reason: String(event.reason),
    });
  });
}

// Get crash summary for display
export function getCrashSummary(): {
  total: number;
  byType: Record<string, number>;
  recent: CrashLog[];
} {
  const logs = getCrashLogs();
  const byType: Record<string, number> = {};
  
  for (const log of logs) {
    byType[log.type] = (byType[log.type] || 0) + 1;
  }

  return {
    total: logs.length,
    byType,
    recent: logs.slice(0, 10),
  };
}
