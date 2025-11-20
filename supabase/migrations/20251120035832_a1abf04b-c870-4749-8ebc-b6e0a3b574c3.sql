-- Create remote scan sessions table for phone-to-computer pairing
CREATE TABLE IF NOT EXISTS public.remote_scan_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, connected, disconnected
  phone_connected_at TIMESTAMP WITH TIME ZONE,
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '1 hour')
);

-- Enable RLS
ALTER TABLE public.remote_scan_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own sessions"
  ON public.remote_scan_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sessions"
  ON public.remote_scan_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions"
  ON public.remote_scan_sessions
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sessions"
  ON public.remote_scan_sessions
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add index for faster lookups
CREATE INDEX idx_remote_scan_sessions_code ON public.remote_scan_sessions(session_code);
CREATE INDEX idx_remote_scan_sessions_user ON public.remote_scan_sessions(user_id);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.remote_scan_sessions;