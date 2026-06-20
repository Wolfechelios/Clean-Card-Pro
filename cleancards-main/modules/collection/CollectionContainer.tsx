"use client";

import { useMemo, useState } from "react";

type CollectionItem = {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  value?: number;
};

export default function CollectionContainer(props: { items?: CollectionItem[] }) {
  const [q, setQ] = useState("");
  const items = props.items ?? [];

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) => {
      const t = (x.title || "").toLowerCase();
      const sub = (x.subtitle || "").toLowerCase();
      return t.includes(s) || sub.includes(s);
    });
  }, [items, q]);

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <input
          className="w-full max-w-md rounded-md border px-3 py-2 text-sm"
          placeholder="Search collection…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="text-xs opacity-70">{filtered.length} items</div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm opacity-70">
          Collection is empty. Scan cards to populate it.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {filtered.map((it) => (
            <div key={it.id} className="rounded-lg border p-3">
              <div className="aspect-[3/4] w-full overflow-hidden rounded-md border bg-white">
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.imageUrl} alt={it.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs opacity-60">
                    No image
                  </div>
                )}
              </div>

              <div className="mt-2 text-sm font-medium line-clamp-1">{it.title}</div>
              {it.subtitle ? (
                <div className="text-xs opacity-70 line-clamp-1">{it.subtitle}</div>
              ) : null}

              {typeof it.value === "number" ? (
                <div className="mt-2 text-xs font-semibold">${it.value.toFixed(2)}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}