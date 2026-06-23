-- See root supabase/migrations/20260623000100_rapidscan_card_images_public.sql
UPDATE storage.buckets
SET public = true
WHERE id = 'card-images';
