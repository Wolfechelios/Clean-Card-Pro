-- Create n8n_webhooks table to store user webhook configurations
CREATE TABLE public.n8n_webhooks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  workflow_type TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  webhook_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, workflow_type)
);

-- Create n8n_webhook_logs table for tracking webhook triggers
CREATE TABLE public.n8n_webhook_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  webhook_id UUID REFERENCES public.n8n_webhooks(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'triggered',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.n8n_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.n8n_webhook_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for n8n_webhooks
CREATE POLICY "Users can view their own webhooks"
ON public.n8n_webhooks FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own webhooks"
ON public.n8n_webhooks FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own webhooks"
ON public.n8n_webhooks FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own webhooks"
ON public.n8n_webhooks FOR DELETE
USING (auth.uid() = user_id);

-- RLS policies for n8n_webhook_logs
CREATE POLICY "Users can view their own webhook logs"
ON public.n8n_webhook_logs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own webhook logs"
ON public.n8n_webhook_logs FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Add trigger for updated_at on n8n_webhooks
CREATE TRIGGER update_n8n_webhooks_updated_at
BEFORE UPDATE ON public.n8n_webhooks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();