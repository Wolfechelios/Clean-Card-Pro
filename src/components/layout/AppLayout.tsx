import { SideBar } from "./SideBar";
import { NavBar } from "./NavBar";
import { ReactNode, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface AppLayoutProps {
  children: ReactNode;
}

function PageLoader() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-6">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen min-h-[100dvh] flex w-full bg-background safe-top safe-bottom">
      <SideBar />
      <div className="flex-1 flex flex-col w-full min-w-0 transition-gpu">
        <NavBar />
        <main className="flex-1 p-3 sm:p-4 md:p-6 lg:p-8 overflow-auto touch-pan-y">
          <Suspense fallback={<PageLoader />}>
            <div className="max-w-[1920px] mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
              {children}
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
