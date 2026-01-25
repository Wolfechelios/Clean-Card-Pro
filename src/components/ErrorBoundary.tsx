import React, { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { logCrash } from "@/lib/crashAnalytics";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

// Check if error is a dynamic import failure
function isDynamicImportError(error: Error | null): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() || '';
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('loading chunk') ||
    message.includes('loading css chunk') ||
    message.includes('dynamically imported module')
  );
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    retryCount: 0,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    
    // Log to crash analytics
    logCrash('component_error', error, {
      componentStack: errorInfo.componentStack,
    });
    
    // Auto-retry for dynamic import errors (likely network issues)
    if (isDynamicImportError(error) && this.state.retryCount < 2) {
      setTimeout(() => {
        this.setState(prev => ({ 
          hasError: false, 
          error: null, 
          retryCount: prev.retryCount + 1 
        }));
      }, 1000);
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    // Clear cache and reload for dynamic import errors
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isNetworkError = isDynamicImportError(this.state.error);

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <div className={`p-4 rounded-full mb-4 ${isNetworkError ? 'bg-warning/10' : 'bg-destructive/10'}`}>
            {isNetworkError ? (
              <WifiOff className="h-12 w-12 text-warning" />
            ) : (
              <AlertTriangle className="h-12 w-12 text-destructive" />
            )}
          </div>
          <h2 className="text-xl font-semibold mb-2">
            {isNetworkError ? "Connection Issue" : "Something went wrong"}
          </h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            {isNetworkError 
              ? "Failed to load the page. Please check your connection and try again."
              : (this.state.error?.message || "An unexpected error occurred")
            }
          </p>
          <div className="flex gap-3">
            {!isNetworkError && (
              <Button variant="outline" onClick={this.handleReset}>
                Try Again
              </Button>
            )}
            <Button onClick={this.handleReload}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reload Page
            </Button>
          </div>
          {this.state.retryCount > 0 && (
            <p className="text-xs text-muted-foreground mt-4">
              Retry attempt {this.state.retryCount}/2
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
