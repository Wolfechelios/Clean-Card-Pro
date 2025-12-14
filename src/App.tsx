import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import AppLayout from "./components/layout/AppLayout";
import Auth from "./pages/Auth";
import NewDashboard from "./pages/NewDashboard";
import ScanPage from "./pages/ScanPage";
import CollectionsPage from "./pages/CollectionsPage";
import BindersPage from "./pages/BindersPage";
import SettingsPage from "./pages/SettingsPage";
import InsightsPage from "./pages/InsightsPage";
import PerformancePage from "./pages/PerformancePage";
import ArchitecturePage from "./pages/ArchitecturePage";
import RoadmapPage from "./pages/RoadmapPage";

import MobileScanPage from "./pages/MobileScanPage";
import MobileScanRedirect from "./pages/MobileScanRedirect";
import PredictionsPage from "./pages/PredictionsPage";
import GradedScanPage from "./pages/GradedScanPage";
import VisualSearchPage from "./pages/VisualSearchPage";
import AdvancedAnalyticsPage from "./pages/AdvancedAnalyticsPage";
import CardPriceHubPage from "./pages/CardPriceHubPage";
import ImageBackfillPage from "./pages/ImageBackfillPage";
import ImportCleanerPage from "./pages/ImportCleanerPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route
        path="/"
        element={session ? <Navigate to="/dashboard" /> : <Navigate to="/auth" />}
      />
      <Route
        path="/dashboard"
        element={session ? <AppLayout><NewDashboard /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/scan"
        element={session ? <AppLayout><ScanPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/collections"
        element={session ? <AppLayout><CollectionsPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/binders"
        element={session ? <AppLayout><BindersPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/settings"
        element={session ? <AppLayout><SettingsPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/insights"
        element={session ? <AppLayout><InsightsPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/performance"
        element={session ? <AppLayout><PerformancePage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/architecture"
        element={session ? <AppLayout><ArchitecturePage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/roadmap"
        element={session ? <AppLayout><RoadmapPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/mobile-scan"
        element={session ? <MobileScanPage /> : <Navigate to="/auth" />}
      />
      <Route
        path="/mobile-scanner"
        element={session ? <MobileScanRedirect /> : <Navigate to="/auth" />}
      />
      <Route
        path="/predictions"
        element={session ? <AppLayout><PredictionsPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/graded"
        element={session ? <AppLayout><GradedScanPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/graded-scan"
        element={session ? <AppLayout><GradedScanPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/visual-search"
        element={session ? <AppLayout><VisualSearchPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/analytics"
        element={session ? <AppLayout><AdvancedAnalyticsPage /></AppLayout> : <Navigate to="/auth" />}
      />
      <Route
        path="/price-hub"
        element={session ? <CardPriceHubPage /> : <Navigate to="/auth" />}
      />
      <Route
        path="/image-backfill"
        element={session ? <ImageBackfillPage /> : <Navigate to="/auth" />}
      />
      <Route
        path="/import-cleaner"
        element={session ? <ImportCleanerPage /> : <Navigate to="/auth" />}
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
