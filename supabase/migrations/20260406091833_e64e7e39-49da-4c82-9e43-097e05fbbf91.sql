
-- Remove tables from Realtime publication
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.cards;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.remote_scan_sessions;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Fix storage INSERT policy to enforce path ownership
DROP POLICY IF EXISTS "card_images_auth_insert" ON storage.objects;
CREATE POLICY "card_images_owner_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'card-images'
  AND (storage.foldername(name))[1] = 'cards'
);
