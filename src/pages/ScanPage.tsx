import Scanner from "@/components/Scanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function getLocalUserId() {
  const key = "clean_card_local_user_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = `local-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  localStorage.setItem(key, id);
  return id;
}

export default function ScanPage() {
  return (
    <div className="container mx-auto p-6">
      {/* Scoped boundary: a scanner crash shows here instead of blanking the app. */}
      <ErrorBoundary>
        <Scanner userId={getLocalUserId()} />
      </ErrorBoundary>
    </div>
  );
}
