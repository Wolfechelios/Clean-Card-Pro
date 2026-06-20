
-- Foil Trainer: correction history + learning memory

CREATE TABLE public.foil_scan_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  scan_id text,
  image_hash text,
  perceptual_hash text,
  card_id uuid,
  game text,
  set_id text,
  set_name text,
  card_number text,
  predicted_card_name text,
  predicted_rarity text,
  corrected_rarity text,
  predicted_finish text,
  corrected_finish text,
  foil_confidence numeric,
  parallel_confidence numeric,
  was_correct boolean NOT NULL DEFAULT false,
  issue_tags text[] DEFAULT '{}',
  original_image_uri text,
  processed_image_uri text,
  reconditioned_image_uri text,
  roi_metadata jsonb,
  lighting_metadata jsonb,
  reflection_metadata jsonb,
  ocr_snapshot jsonb,
  device_info jsonb,
  user_confirmed_at timestamptz
);

ALTER TABLE public.foil_scan_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own foil corrections"
  ON public.foil_scan_corrections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own foil corrections"
  ON public.foil_scan_corrections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own foil corrections"
  ON public.foil_scan_corrections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own foil corrections"
  ON public.foil_scan_corrections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE public.foil_learning_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key_type text NOT NULL,
  key_value text NOT NULL,
  game text,
  corrected_finish text,
  corrected_rarity text,
  support_count integer NOT NULL DEFAULT 1,
  reject_count integer NOT NULL DEFAULT 0,
  confidence_weight numeric NOT NULL DEFAULT 0.5,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key_type, key_value, corrected_finish)
);

ALTER TABLE public.foil_learning_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own foil learning"
  ON public.foil_learning_memory FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own foil learning"
  ON public.foil_learning_memory FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own foil learning"
  ON public.foil_learning_memory FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own foil learning"
  ON public.foil_learning_memory FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_foil_corrections_user ON public.foil_scan_corrections(user_id);
CREATE INDEX idx_foil_corrections_card ON public.foil_scan_corrections(card_id);
CREATE INDEX idx_foil_corrections_hash ON public.foil_scan_corrections(image_hash);
CREATE INDEX idx_foil_learning_key ON public.foil_learning_memory(user_id, key_type, key_value);
