-- Create table for user-specific API keys
CREATE TABLE public.user_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key_name TEXT NOT NULL,
    key_value TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, key_name)
);

-- Enable RLS
ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

-- Users can only see their own keys
CREATE POLICY "Users can view their own API keys"
ON public.user_api_keys FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own keys
CREATE POLICY "Users can insert their own API keys"
ON public.user_api_keys FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own keys
CREATE POLICY "Users can update their own API keys"
ON public.user_api_keys FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own keys
CREATE POLICY "Users can delete their own API keys"
ON public.user_api_keys FOR DELETE
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_user_api_keys_updated_at
BEFORE UPDATE ON public.user_api_keys
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_user_api_keys_user_id ON public.user_api_keys(user_id);
CREATE INDEX idx_user_api_keys_key_name ON public.user_api_keys(key_name);