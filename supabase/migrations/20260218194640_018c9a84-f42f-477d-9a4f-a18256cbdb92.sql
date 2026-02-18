
-- PriceCharting local pricing database tables

-- Sets table: one row per unique set
CREATE TABLE public.pc_sets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  game TEXT NOT NULL DEFAULT 'yugioh',
  set_code TEXT,
  set_name TEXT NOT NULL,
  set_name_raw TEXT,
  source_url TEXT,
  source_file_hash TEXT,
  total_cards INTEGER DEFAULT 0,
  imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint: user can't have duplicate sets
CREATE UNIQUE INDEX idx_pc_sets_user_game_code ON public.pc_sets (user_id, game, set_code) WHERE set_code IS NOT NULL;
CREATE UNIQUE INDEX idx_pc_sets_user_game_name ON public.pc_sets (user_id, game, set_name) WHERE set_code IS NULL;
CREATE INDEX idx_pc_sets_user ON public.pc_sets (user_id);

ALTER TABLE public.pc_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sets" ON public.pc_sets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own sets" ON public.pc_sets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own sets" ON public.pc_sets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own sets" ON public.pc_sets FOR DELETE USING (auth.uid() = user_id);

-- Cards master table: every card in every imported set
CREATE TABLE public.pc_cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  set_id UUID NOT NULL REFERENCES public.pc_sets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  card_name TEXT NOT NULL,
  card_name_clean TEXT NOT NULL,
  card_number TEXT,
  variant TEXT,
  rarity TEXT,
  card_url TEXT,
  ungraded_price NUMERIC,
  graded_price NUMERIC,
  grade9_price NUMERIC,
  psa10_price NUMERIC,
  price_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Match indexes: primary match key
CREATE UNIQUE INDEX idx_pc_cards_set_number_variant ON public.pc_cards (set_id, card_number, COALESCE(variant, '')) WHERE card_number IS NOT NULL;
-- Fallback match by name
CREATE INDEX idx_pc_cards_set_name ON public.pc_cards (set_id, card_name_clean);
-- User filter
CREATE INDEX idx_pc_cards_user ON public.pc_cards (user_id);
-- Trigram index for fuzzy matching
CREATE INDEX idx_pc_cards_name_trgm ON public.pc_cards USING GIN (card_name_clean gin_trgm_ops);

ALTER TABLE public.pc_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cards" ON public.pc_cards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own cards" ON public.pc_cards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own cards" ON public.pc_cards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own cards" ON public.pc_cards FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at on pc_sets
CREATE TRIGGER update_pc_sets_updated_at
BEFORE UPDATE ON public.pc_sets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
