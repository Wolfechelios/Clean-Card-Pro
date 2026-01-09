-- Add PSA 10 viability tracking columns
ALTER TABLE public.cards
ADD COLUMN IF NOT EXISTS psa10_viable boolean DEFAULT NULL,
ADD COLUMN IF NOT EXISTS psa10_viable_confidence integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS psa10_viable_notes text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS psa10_analyzed_at timestamptz DEFAULT NULL;

-- Add index for efficient filtering of PSA 10 viable cards
CREATE INDEX IF NOT EXISTS idx_cards_psa10_viable ON public.cards (user_id, psa10_viable) WHERE psa10_viable = true;