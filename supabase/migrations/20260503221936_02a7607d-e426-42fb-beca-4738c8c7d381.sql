CREATE UNIQUE INDEX IF NOT EXISTS price_cache_identity_source_idx
  ON public.price_cache (identity_hash, source);