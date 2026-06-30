import Scanner from "@/components/Scanner";

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
      <Scanner userId={getLocalUserId()} />
    </div>
  );
}
