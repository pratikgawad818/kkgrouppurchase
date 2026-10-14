DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;
CREATE POLICY "Avatar signed-in read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars');