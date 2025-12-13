import { SideBar } from "./SideBar";
import { NavBar } from "./NavBar";
import { ReactNode, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

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
  return (
    <div className="min-h-screen min-h-[100dvh] flex w-full bg-background safe-top safe-bottom">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-glow pointer-events-none opacity-30" aria-hidden="true" />
      
      <SideBar />
      <div className="flex-1 flex flex-col w-full min-w-0 transition-gpu relative">
        <NavBar />
        <main className="flex-1 p-4 sm:p-5 md:p-6 lg:p-8 overflow-auto touch-pan-y">
          <Suspense fallback={<PageLoader />}>
            <div className="max-w-[1920px] mx-auto animate-fade-in-up">
              {children}
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
