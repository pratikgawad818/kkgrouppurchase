ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text, ADD COLUMN IF NOT EXISTS dob date;

CREATE OR REPLACE FUNCTION public.update_my_profile(_full_name text, _phone text, _dob date, _department text, _designation text, _avatar_url text)
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _dob IS NOT NULL AND _dob > current_date THEN RAISE EXCEPTION 'Date of birth cannot be in the future'; END IF;
  UPDATE public.profiles SET
    full_name = NULLIF(btrim(_full_name), ''),
    phone = NULLIF(btrim(_phone), ''),
    dob = _dob,
    department = NULLIF(btrim(_department), ''),
    designation = NULLIF(btrim(_designation), ''),
    avatar_url = NULLIF(btrim(_avatar_url), '')
  WHERE id = auth.uid() RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.update_my_profile(text,text,date,text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text,text,date,text,text,text) TO authenticated;

CREATE POLICY "Avatar public read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Avatar own insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Avatar own update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Avatar own delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);