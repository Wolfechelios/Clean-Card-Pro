
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AppLayout from "./components/layout/AppLayout";
import { lazy, Suspense, useEffect, useState } from "react";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { installGlobalErrorHandlers } from "@/lib/crashAnalytics";
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

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  return session ? <AppLayout>{children}</AppLayout> : <Navigate to="/auth" replace />;
}

function AppRoutes() {
  const { session, loading } = useAuth();

  if (loading) return <FullscreenLoader />;

  return (
    <Suspense fallback={<FullscreenLoader />}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/install" element={<InstallPage />} />
        <Route path="/" element={<Navigate to={session ? "/dashboard" : "/auth"} replace />} />

        <Route path="/dashboard" element={<ProtectedRoute><NewDashboard /></ProtectedRoute>} />
        <Route path="/scan" element={<ProtectedRoute><ScanPage /></ProtectedRoute>} />
        <Route path="/collections" element={<ProtectedRoute><CollectionsPage /></ProtectedRoute>} />
        <Route path="/binders" element={<ProtectedRoute><BindersPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/insights" element={<ProtectedRoute><InsightsPage /></ProtectedRoute>} />
        <Route path="/performance" element={<ProtectedRoute><PerformancePage /></ProtectedRoute>} />
        <Route path="/mobile-scan" element={<ProtectedRoute><MobileScanPage /></ProtectedRoute>} />
        <Route path="/mobile-scan-redirect" element={<ProtectedRoute><MobileScanRedirect /></ProtectedRoute>} />
        <Route path="/predictions" element={<ProtectedRoute><PredictionsPage /></ProtectedRoute>} />
        <Route path="/graded-scan" element={<ProtectedRoute><GradedScanPage /></ProtectedRoute>} />
        <Route path="/visual-search" element={<ProtectedRoute><VisualSearchPage /></ProtectedRoute>} />
        <Route path="/card-price-hub" element={<ProtectedRoute><CardPriceHubPage /></ProtectedRoute>} />
        <Route path="/image-backfill" element={<ProtectedRoute><ImageBackfillPage /></ProtectedRoute>} />
        <Route path="/import-cleaner" element={<ProtectedRoute><ImportCleanerPage /></ProtectedRoute>} />
        <Route path="/sell-assist" element={<ProtectedRoute><SellAssistPage /></ProtectedRoute>} />
        <Route path="/help" element={<ProtectedRoute><HelpPage /></ProtectedRoute>} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  const [queryClient] = useState(createQueryClient);
  const [showSplash, setShowSplash] = useState(true);
  const { session } = useAuth();
  const { showOnboarding } = usePWAOnboarding();

  useEffect(() => {
    const timeout = setTimeout(() => setShowSplash(false), 3000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!session) return;
    installGlobalErrorHandlers();
    checkAndResumeQueue();
  }, [session]);

  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <HashRouter>
              <OfflineIndicator />
              <QueueStatusIndicator />
              <PWAInstallBanner />
              {showOnboarding && <PWAOnboarding />}
              <AppRoutes />
            </HashRouter>
            <Toaster />
            <Sonner />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
