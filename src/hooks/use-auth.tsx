import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { User, Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { SessionExpiredDialog } from "@/components/auth/SessionExpiredDialog";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  userId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Force session recovery dialog (e.g. after detecting stale token) */
  triggerSessionRecovery: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Module-scope flag to prevent duplicate price updates across remounts
let priceUpdateTriggered = false;

// Listen for auth errors globally (e.g. from network requests)
function isRefreshTokenError(error: unknown): boolean {
  const msg = String((error as any)?.message ?? error).toLowerCase();
  return (
    msg.includes("refresh_token_not_found") ||
    msg.includes("invalid refresh token") ||
    msg.includes("session_not_found")
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [lastEmail, setLastEmail] = useState<string | null>(null);

  const clearAuthState = useCallback(async () => {
    // Force sign-out and clear local storage keys
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Ignore errors during force sign-out
    }
    // Clear any stale tokens from local storage
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (key.startsWith("sb-") && key.includes("-auth-token")) {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // Ignore
    }
    setSession(null);
    setUser(null);
  }, []);

  const triggerSessionRecovery = useCallback(() => {
    if (user?.email) {
      setLastEmail(user.email);
    }
    clearAuthState().then(() => {
      setShowRecoveryDialog(true);
    });
  }, [user?.email, clearAuthState]);

  useEffect(() => {
    const triggerPriceUpdate = (userId: string) => {
      if (priceUpdateTriggered) return;
      priceUpdateTriggered = true;

      setTimeout(() => {
        supabase.functions
          .invoke("update-prices", { body: { user_id: userId } })
          .then(() => console.log("Background price update started"))
          .catch((err) => console.error("Price update error:", err));
      }, 100);
    };

    // Set up auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Reset flag on sign out so next sign in can trigger update
      if (event === "SIGNED_OUT") {
        priceUpdateTriggered = false;
      } else if (session?.user?.id) {
        triggerPriceUpdate(session.user.id);
      }
    });

    // THEN check for existing session
    supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error && isRefreshTokenError(error)) {
          // Session is invalid, trigger recovery
          triggerSessionRecovery();
          return;
        }
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        if (session?.user?.id) {
          triggerPriceUpdate(session.user.id);
        }
      })
      .catch((err) => {
        if (isRefreshTokenError(err)) {
          triggerSessionRecovery();
        } else {
          setLoading(false);
        }
      });

    // Global interceptor for auth errors on any supabase call
    const handleGlobalAuthError = (event: CustomEvent<{ error: AuthError }>) => {
      if (isRefreshTokenError(event.detail.error)) {
        triggerSessionRecovery();
      }
    };

    // Supabase client emits custom events for auth errors (we can also patch fetch)
    window.addEventListener("supabase-auth-error" as any, handleGlobalAuthError as any);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("supabase-auth-error" as any, handleGlobalAuthError as any);
    };
  }, [triggerSessionRecovery]);

  // Patch fetch to detect auth errors in responses
  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      // Clone to read body without consuming it
      if (!response.ok && response.status === 400) {
        try {
          const cloned = response.clone();
          const text = await cloned.text();
          if (
            text.includes("refresh_token_not_found") ||
            text.includes("Invalid Refresh Token")
          ) {
            triggerSessionRecovery();
          }
        } catch {
          // Ignore parse errors
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [triggerSessionRecovery]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value: AuthContextType = {
    user,
    session,
    userId: user?.id ?? null,
    loading,
    signOut,
    triggerSessionRecovery,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SessionExpiredDialog
        open={showRecoveryDialog}
        email={lastEmail}
        onClose={() => setShowRecoveryDialog(false)}
        onSuccess={() => setShowRecoveryDialog(false)}
      />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
