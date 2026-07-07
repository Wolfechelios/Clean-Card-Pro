import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AppLayout from "./components/layout/AppLayout";
import { lazy, Suspense, useState } from "react";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { QueueStatusIndicator } from "@/components/scanner/QueueStatusIndicator";
const PipelineHealthPanel = lazy(() =>
  import("@/components/scanner/PipelineHealthPanel").then((m) => ({ default: m.PipelineHealthPanel }))
);
import { SplashScreen } from "@/components/SplashScreen";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { useQueueAutoResume } from "@/hooks/use-queue-auto-resume";

const Auth = lazy(() => import("./pages/Auth"));
const NewDashboard = lazy(() => import("./pages/NewDashboard"));
const ScanPage = lazy(() => import("./pages/ScanPage"));
const CollectionsPage = lazy(() => import("./pages/CollectionsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const MobileScanPage = lazy(() => import("./pages/MobileScanPage"));
const MobileScanRedirect = lazy(() => import("./pages/MobileScanRedirect"));
const PriceDatabasePage = lazy(() => import("./pages/PriceDatabasePage"));
const BinderPage = lazy(() => import("./pages/BinderPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

function FullscreenLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function LocalPage({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}

function AppRoutes() {
  const page = (children: React.ReactNode) => <LocalPage>{children}</LocalPage>;

  return (
    <Suspense fallback={<FullscreenLoader />}>
      <Routes>
        <Route path="/auth" element={<Navigate to="/scan" replace />} />
        <Route path="/" element={<Navigate to="/scan" replace />} />

        <Route path="/dashboard" element={page(<NewDashboard />)} />
        <Route path="/scan" element={page(<ScanPage />)} />
        <Route path="/collections" element={page(<CollectionsPage />)} />
        <Route path="/binder" element={page(<BinderPage />)} />
        <Route path="/price-database" element={page(<PriceDatabasePage />)} />
        <Route path="/settings" element={page(<SettingsPage />)} />
        <Route path="/mobile-scan" element={<MobileScanPage />} />
        <Route path="/mobile-scanner" element={<MobileScanRedirect />} />

        <Route path="/install" element={<Navigate to="/scan" replace />} />
        <Route path="/graded" element={<Navigate to="/scan" replace />} />
        <Route path="/visual-search" element={<Navigate to="/scan" replace />} />
        <Route path="/price-hub" element={<Navigate to="/price-database" replace />} />
        <Route path="/image-backfill" element={<Navigate to="/settings" replace />} />
        <Route path="/import-cleaner" element={<Navigate to="/price-database" replace />} />
        <Route path="/help" element={<Navigate to="/settings" replace />} />
        <Route path="/sell-assist" element={<Navigate to="/collections" replace />} />
        <Route path="/deck-builder" element={<Navigate to="/collections" replace />} />
        <Route path="/insights" element={<Navigate to="/dashboard" replace />} />
        <Route path="/performance" element={<Navigate to="/dashboard" replace />} />
        <Route path="/predictions" element={<Navigate to="/dashboard" replace />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

const App = () => {
  const [showSplash, setShowSplash] = useState(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes("android-app://");
    return isStandalone;
  });
  useQueueAutoResume();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ErrorBoundary>
            {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AuthProvider>
                <AppRoutes />
                <QueueStatusIndicator />
                <OfflineIndicator />
              </AuthProvider>
            </BrowserRouter>
          </ErrorBoundary>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
