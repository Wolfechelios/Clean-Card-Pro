import { SideBar } from "./SideBar";
import { NavBar } from "./NavBar";
import { ReactNode, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutoSync } from "@/hooks/use-auto-sync";

interface AppLayoutProps {
  children: ReactNode;
}

function PageLoader() {
  return (
    <div className="space-y-6 p-4 animate-fade-in">
      <div className="space-y-2">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-8">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-2 mt-6">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

export default function AppLayout({ children }: AppLayoutProps) {
  // Auto-sync cards for offline use when authenticated
  useAutoSync();

  return (
    <div className="min-h-[100dvh] min-h-screen flex w-full bg-background safe-top safe-bottom">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-glow pointer-events-none opacity-30" aria-hidden="true" />

      <SideBar />

      <div className="flex-1 flex flex-col w-full min-w-0 transition-gpu relative">
        <NavBar />
        <main
          id="main"
          className="flex-1 px-2 py-3 xs:px-3 xs:py-4 sm:px-5 md:px-6 lg:px-8 overflow-y-auto overflow-x-hidden touch-pan-y"
          role="main"
        >
          <Suspense fallback={<PageLoader />}>
            <div className="max-w-[1920px] mx-auto animate-fade-in-up w-full pb-4">{children}</div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
