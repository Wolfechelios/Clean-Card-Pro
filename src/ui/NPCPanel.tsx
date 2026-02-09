
    export default function NPCPanel({ title }: { title: string }) {
      return (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-neutral-400 mt-2">
            Insight engine online.
          </div>
        </div>
      )
    }
    