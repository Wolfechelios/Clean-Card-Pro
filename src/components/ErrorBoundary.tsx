import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("App crashed:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-lg border bg-card p-6 text-card-foreground">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Reload the page. If it keeps happening, try again in a new tab.
            </p>
            <button
              className="mt-4 inline-flex h-10 items-center justify-center rounded-md border bg-background px-4 text-sm"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
