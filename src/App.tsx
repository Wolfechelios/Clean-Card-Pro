import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AppLayout from "./components/layout/AppLayout";
import { lazy, Suspense, useState } from "react";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { QueueStatusIndicator } from "@/components/scanner/QueueStatusIndicator";
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

function Authed({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}

function AppRoutes() {
  const { session, loading } = useAuth();

  if (loading) return <FullscreenLoader />;

  const authed = (children: React.ReactNode) =>
    session ? <Authed>{children}</Authed> : <Navigate to="/auth" replace />;

  const redirectAuthed = (to: string) =>
    session ? <Navigate to={to} replace /> : <Navigate to="/auth" replace />;

  return (
    <Suspense fallback={<FullscreenLoader />}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={redirectAuthed("/dashboard")} />

        <Route path="/dashboard" element={authed(<NewDashboard />)} />
        <Route path="/scan" element={authed(<ScanPage />)} />
        <Route path="/collections" element={authed(<CollectionsPage />)} />
        <Route path="/binder" element={authed(<BinderPage />)} />
        <Route path="/price-database" element={authed(<PriceDatabasePage />)} />
        <Route path="/settings" element={authed(<SettingsPage />)} />
        <Route path="/mobile-scan" element={session ? <MobileScanPage /> : <Navigate to="/auth" replace />} />
        <Route path="/mobile-scanner" element={session ? <MobileScanRedirect /> : <Navigate to="/auth" replace />} />

        {/* Removed clutter routes: keep old links from breaking, but stop loading unused pages. */}
        <Route path="/install" element={redirectAuthed("/dashboard")} />
        <Route path="/graded" element={redirectAuthed("/scan")} />
        <Route path="/visual-search" element={redirectAuthed("/scan")} />
        <Route path="/price-hub" element={redirectAuthed("/price-database")} />
        <Route path="/image-backfill" element={redirectAuthed("/settings")} />
        <Route path="/import-cleaner" element={redirectAuthed("/price-database")} />
        <Route path="/help" element={redirectAuthed("/settings")} />
        <Route path="/sell-assist" element={redirectAuthed("/collections")} />
        <Route path="/deck-builder" element={redirectAuthed("/collections")} />
        <Route path="/insights" element={redirectAuthed("/dashboard")} />
        <Route path="/performance" element={redirectAuthed("/dashboard")} />
        <Route path="/predictions" element={redirectAuthed("/dashboard")} />

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
