
CREATE TABLE IF NOT EXISTS public.card_print_cache (
  game text NOT NULL,
  set_code text NOT NULL,
  collector_number text NOT NULL DEFAULT '',
  card_name text NOT NULL,
  set_name text NOT NULL,
  rarity text,
  external_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game, set_code, collector_number)
);

GRANT SELECT ON public.card_print_cache TO anon, authenticated;
GRANT ALL ON public.card_print_cache TO service_role;

ALTER TABLE public.card_print_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read card cache"
  ON public.card_print_cache FOR SELECT
  USING (true);

CREATE INDEX IF NOT EXISTS card_print_cache_setcode_idx
  ON public.card_print_cache (set_code);
