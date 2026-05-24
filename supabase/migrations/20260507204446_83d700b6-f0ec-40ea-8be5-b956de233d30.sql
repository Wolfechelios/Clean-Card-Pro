UPDATE storage.buckets SET public = true WHERE id = 'card-images';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read card-images'
  ) THEN
    CREATE POLICY "Public read card-images"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'card-images');
  END IF;
END $$;