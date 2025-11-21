import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "./components/layout/AppLayout";
import Auth from "./pages/Auth";
import NewDashboard from "./pages/NewDashboard";
import ScanPage from "./pages/ScanPage";
import CollectionsPage from "./pages/CollectionsPage";
import BindersPage from "./pages/BindersPage";
import SettingsPage from "./pages/SettingsPage";
import InsightsPage from "./pages/InsightsPage";
import VisionTestPage from "./pages/VisionTestPage";
import MobileScanPage from "./pages/MobileScanPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  const [session, setSession] = useState(null);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      
      // Defer Supabase function calls to prevent deadlock
      if (session?.user?.id) {
        setTimeout(() => {
          supabase.functions
            .invoke('update-prices', {
              body: { user_id: session.user.id }
            })
            .then(() => console.log('Background price update started'))
            .catch(err => console.error('Price update error:', err));
        }, 0);
      }
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      
      if (session?.user?.id) {
        setTimeout(() => {
          supabase.functions
            .invoke('update-prices', {
              body: { user_id: session.user.id }
            })
            .then(() => console.log('Background price update started'))
            .catch(err => console.error('Price update error:', err));
        }, 0);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
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
              path="/vision-test"
              element={session ? <AppLayout><VisionTestPage /></AppLayout> : <Navigate to="/auth" />}
            />
            <Route
              path="/mobile-scan"
              element={session ? <MobileScanPage /> : <Navigate to="/auth" />}
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
