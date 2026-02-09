
    export default function ActionCounter() {
      return (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6">
          <div className="text-lg font-semibold">Behind the Counter</div>
          <div className="mt-4 flex gap-2">
            <button className="bg-amber-600 text-black px-4 py-2 rounded-xl">Scan</button>
            <button className="bg-neutral-800 px-4 py-2 rounded-xl">Value</button>
            <button className="bg-neutral-800 px-4 py-2 rounded-xl">List</button>
          </div>
        </div>
      )
    }
    