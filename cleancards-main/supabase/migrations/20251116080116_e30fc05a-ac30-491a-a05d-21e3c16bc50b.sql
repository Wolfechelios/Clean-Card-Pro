-- Create missing RLS policies for card-images bucket
-- Only create if they don't already exist

DO $$
BEGIN
  -- Users can upload their own card images
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND policyname = 'Users can upload their own card images'
  ) THEN
    CREATE POLICY "Users can upload their own card images"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'card-images' 
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
  END IF;

  -- Users can update their own card images
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND policyname = 'Users can update their own card images'
  ) THEN
    CREATE POLICY "Users can update their own card images"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'card-images' 
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
  END IF;

  -- Users can delete their own card images
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND policyname = 'Users can delete their own card images'
  ) THEN
    CREATE POLICY "Users can delete their own card images"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'card-images' 
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
  END IF;
END $$;