-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  username TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Create cards table for scanned cards
CREATE TABLE public.cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  card_set TEXT,
  card_number TEXT,
  rarity TEXT,
  edition TEXT,
  condition TEXT DEFAULT 'ungraded',
  sport_type TEXT,
  game_type TEXT,
  ocr_confidence DECIMAL(5,2),
  ocr_raw_text TEXT,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  current_price_raw DECIMAL(10,2),
  current_price_psa9 DECIMAL(10,2),
  current_price_psa10 DECIMAL(10,2),
  suggested_price DECIMAL(10,2),
  last_price_update TIMESTAMPTZ,
  collection_name TEXT,
  tags TEXT[],
  notes TEXT,
  ebay_listing_id TEXT,
  ebay_listing_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

-- RLS Policies for cards
CREATE POLICY "Users can view own cards"
  ON public.cards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cards"
  ON public.cards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cards"
  ON public.cards FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own cards"
  ON public.cards FOR DELETE
  USING (auth.uid() = user_id);

-- Create price_history table for tracking price changes
CREATE TABLE public.price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  price_raw DECIMAL(10,2),
  price_psa9 DECIMAL(10,2),
  price_psa10 DECIMAL(10,2),
  source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for price_history (through card ownership)
CREATE POLICY "Users can view price history of own cards"
  ON public.price_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cards
      WHERE cards.id = price_history.card_id
      AND cards.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert price history for own cards"
  ON public.price_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cards
      WHERE cards.id = price_history.card_id
      AND cards.user_id = auth.uid()
    )
  );

-- Create scan_sessions table for binder mode
CREATE TABLE public.scan_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name TEXT,
  total_cards INTEGER DEFAULT 0,
  total_value DECIMAL(10,2) DEFAULT 0,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scan_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for scan_sessions
CREATE POLICY "Users can view own scan sessions"
  ON public.scan_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scan sessions"
  ON public.scan_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scan sessions"
  ON public.scan_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own scan sessions"
  ON public.scan_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Create storage bucket for card images
INSERT INTO storage.buckets (id, name, public)
VALUES ('card-images', 'card-images', true);

-- Storage policies for card images
CREATE POLICY "Users can upload own card images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'card-images' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view own card images"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'card-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Anyone can view card images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'card-images');

CREATE POLICY "Users can update own card images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'card-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own card images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'card-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Trigger for profiles updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_cards_updated_at
BEFORE UPDATE ON public.cards
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();