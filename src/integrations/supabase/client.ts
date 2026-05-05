import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Clean Card Pro Supabase boot guard.
 *
 * Vite only exposes env vars prefixed with VITE_. If the app is accidentally
 * deployed from the wrong repo/build target, these can disappear and auth fails
 * with vague "failed to fetch" or blank sign-in behavior. The fallback below
 * keeps the production app pointed at the intended Clean Card Pro Supabase
 * project instead of silently creating a broken client.
 */
const FALLBACK_SUPABASE_URL = 'https://cyyaapagcftbhafhlofb.supabase.co';
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5eWFhcGFnY2Z0YmhhZmhsb2ZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNTYxMzgsImV4cCI6MjA3ODczMjEzOH0.K5sChtzKjOODm2yrQKYhx8WcZ832z6Tc5BFvQtEqhtw';

const envUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const envKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

const SUPABASE_URL = envUrl || FALLBACK_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = envKey || FALLBACK_SUPABASE_PUBLISHABLE_KEY;

export const supabaseRuntimeStatus = {
  url: SUPABASE_URL,
  projectRef: (() => {
    try {
      return new URL(SUPABASE_URL).hostname.split('.')[0] || 'unknown';
    } catch {
      return 'invalid-url';
    }
  })(),
  hasViteUrl: Boolean(envUrl),
  hasVitePublishableKey: Boolean(envKey),
  usingFallbackUrl: !envUrl,
  usingFallbackPublishableKey: !envKey,
  isConfigured: Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY),
};

if (!envUrl || !envKey) {
  console.warn(
    '[Clean Card Pro] Supabase VITE env vars are missing. Using built-in production fallback.',
    supabaseRuntimeStatus,
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

export async function clearCleanCardAuthCache() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Continue clearing local state even if Supabase refuses a stale token.
  }

  try {
    for (const key of Object.keys(localStorage)) {
      if (
        key.startsWith('sb-') ||
        key.includes('supabase') ||
        key.includes('auth-token') ||
        key.includes('clean-card-auth')
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore browser storage restrictions.
  }

  try {
    sessionStorage.clear();
  } catch {
    // Ignore browser storage restrictions.
  }

  try {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }
  } catch {
    // Cache API may be unavailable in some browsers/webviews.
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // Service worker may be blocked or unsupported.
  }
}
