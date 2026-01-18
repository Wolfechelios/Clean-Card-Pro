import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AppLayout from "./components/layout/AppLayout";
import { lazy, Suspense, useEffect, useState, forwardRef } from "react";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { checkAndResumeQueue } from "@/lib/queueProcessor";
import { QueueStatusIndicator } from "@/components/scanner/QueueStatusIndicator";
import { SplashScreen } from "@/components/SplashScreen";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { PWAOnboarding } from "@/components/pwa/PWAOnboarding";
import { PWAInstallBanner } from "@/components/pwa/PWAInstallBanner";
import { usePWAOnboarding } from "@/hooks/use-pwa-onboarding";

const Auth = lazy(() => import("./pages/Auth"));
const NewDashboard = lazy(() => import("./pages/NewDashboard"));
const ScanPage = lazy(() => import("./pages/ScanPage"));
const CollectionsPage = lazy(() => import("./pages/CollectionsPage"));
const BindersPage = lazy(() => import("./pages/BindersPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const InsightsPage = lazy(() => import("./pages/InsightsPage"));
const PerformancePage = lazy(() => import("./pages/PerformancePage"));
const MobileScanPage = lazy(() => import("./pages/MobileScanPage"));
const MobileScanRedirect = lazy(() => import("./pages/MobileScanRedirect"));
const PredictionsPage = lazy(() => import("./pages/PredictionsPage"));
const GradedScanPage = lazy(() => import("./pages/GradedScanPage"));
const VisualSearchPage = lazy(() => import("./pages/VisualSearchPage"));
const CardPriceHubPage = lazy(() => import("./pages/CardPriceHubPage"));
const ImageBackfillPage = lazy(() => import("./pages/ImageBackfillPage"));
const ImportCleanerPage = lazy(() => import("./pages/ImportCleanerPage"));
const HelpPage = lazy(() => import("./pages/HelpPage"));
const SellAssistPage = lazy(() => import("./pages/SellAssistPage"));
const InstallPage = lazy(() => import("./pages/InstallPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

const FullscreenLoader = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
});
FullscreenLoader.displayName = "FullscreenLoader";

function Authed({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}

function AppRoutes() {
  const { session, loading } = useAuth();

  if (loading) return <FullscreenLoader />;

  return (
    <Suspense fallback={<FullscreenLoader />}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/install" element={<InstallPage />} />
        <Route path="/" element={session ? <Navigate to="/dashboard" /> : <Navigate to="/auth" />} />

        <Route path="/dashboard" element={session ? <Authed><NewDashboard /></Authed> : <Navigate to="/auth" />} />
        <Route path="/scan" element={session ? <Authed><ScanPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/collections" element={session ? <Authed><CollectionsPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/binders" element={session ? <Authed><BindersPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/settings" element={session ? <Authed><SettingsPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/insights" element={session ? <Authed><InsightsPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/performance" element={session ? <Authed><PerformancePage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/mobile-scan" element={session ? <MobileScanPage /> : <Navigate to="/auth" />} />
        <Route path="/mobile-scanner" element={session ? <MobileScanRedirect /> : <Navigate to="/auth" />} />
        <Route path="/predictions" element={session ? <Authed><PredictionsPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/graded" element={session ? <Authed><GradedScanPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/visual-search" element={session ? <Authed><VisualSearchPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/price-hub" element={session ? <Authed><CardPriceHubPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/sell-assist" element={session ? <Authed><SellAssistPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/image-backfill" element={session ? <Authed><ImageBackfillPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/import-cleaner" element={session ? <Authed><ImportCleanerPage /></Authed> : <Navigate to="/auth" />} />
        <Route path="/help" element={session ? <Authed><HelpPage /></Authed> : <Navigate to="/auth" />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

function PWAWrapper({ children }: { children: React.ReactNode }) {
  const { shouldShowOnboarding, completeOnboarding, isStandalone } = usePWAOnboarding();

  return (
    <>
      {shouldShowOnboarding && (
        <PWAOnboarding 
          onComplete={completeOnboarding} 
          onSkip={completeOnboarding}
        />
      )}
      {children}
      {/* Show install banner only when not in standalone mode */}
      {!isStandalone && <PWAInstallBanner />}
    </>
  );
}

const App = () => {
  const [showSplash, setShowSplash] = useState(() => {
    // Only show splash when launched as PWA (standalone mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://');
    return isStandalone;
  });

  // Auto-resume queue processing on app start
  useEffect(() => {
    checkAndResumeQueue();
  }, []);

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
                <PWAWrapper>
                  <AppRoutes />
                  <QueueStatusIndicator />
                  <OfflineIndicator />
                </PWAWrapper>
              </AuthProvider>
            </BrowserRouter>
          </ErrorBoundary>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
