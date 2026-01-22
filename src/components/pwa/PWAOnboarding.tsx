export function PWAOnboarding({ onComplete, onSkip }: { onComplete: () => void; onSkip: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-card-foreground">
        <h2 className="text-lg font-semibold">Install for fastest scanning</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Adding this to your home screen improves camera stability and offline support.
        </p>
        <div className="mt-4 flex gap-2">
          <button className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground" onClick={onComplete}>
            Got it
          </button>
          <button className="h-10 rounded-md border bg-background px-4 text-sm" onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
