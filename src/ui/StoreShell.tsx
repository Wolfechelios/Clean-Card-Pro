
    export default function StoreShell({ children }: any) {
      return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100">
          <div className="max-w-7xl mx-auto">
            <header className="p-4 text-xl font-bold border-b border-neutral-800">
              My Card Store
            </header>
            {children}
          </div>
        </div>
      )
    }
    