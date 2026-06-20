-- Fix n8n_webhooks - add foreign key CASCADE to auth.users
ALTER TABLE public.n8n_webhooks
DROP CONSTRAINT IF EXISTS n8n_webhooks_user_id_fkey,
ADD CONSTRAINT n8n_webhooks_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES auth.users(id) 
  ON DELETE CASCADE;

-- Fix n8n_webhook_logs - add foreign key CASCADE to auth.users
ALTER TABLE public.n8n_webhook_logs
DROP CONSTRAINT IF EXISTS n8n_webhook_logs_user_id_fkey,
ADD CONSTRAINT n8n_webhook_logs_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES auth.users(id) 
  ON DELETE CASCADE;

-- Fix remote_scan_sessions - add foreign key CASCADE to auth.users
ALTER TABLE public.remote_scan_sessions
DROP CONSTRAINT IF EXISTS remote_scan_sessions_user_id_fkey,
ADD CONSTRAINT remote_scan_sessions_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES auth.users(id) 
  ON DELETE CASCADE;

-- Fix price_jobs - add foreign key CASCADE to auth.users
ALTER TABLE public.price_jobs
DROP CONSTRAINT IF EXISTS price_jobs_user_id_fkey,
ADD CONSTRAINT price_jobs_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES auth.users(id) 
  ON DELETE CASCADE;