// Supabase client kept only for legacy auth/database imports.
// Disabled Remote Paths are intentionally disabled and must not be used by this app.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'local-only-disabled';

const client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});

(client as any).functions = {
  invoke: async (functionName: string) => ({
    data: null,
    error: {
      name: 'SupabaseFunctionsDisabled',
      message: `Supabase Disabled Remote Paths are disabled in this app: ${functionName}`,
    },
  }),
};

export const supabase = client;
