ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS office_phone text;
CREATE OR REPLACE FUNCTION public.update_my_office_phone(_office_phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF length(coalesce(_office_phone,'')) > 20 THEN RAISE EXCEPTION 'Office phone is too long'; END IF;
  UPDATE public.profiles SET office_phone = NULLIF(btrim(_office_phone), '') WHERE id = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.update_my_office_phone(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_my_office_phone(text) TO authenticated;