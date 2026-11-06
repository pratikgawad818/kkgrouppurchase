CREATE OR REPLACE FUNCTION public.ensure_profile()
 RETURNS profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); p public.profiles%ROWTYPE; v_company uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id = v_uid;
  IF FOUND THEN RETURN p; END IF;
  SELECT id INTO v_company FROM public.companies ORDER BY created_at LIMIT 1;
  INSERT INTO public.profiles(id, company_id, email, full_name)
  VALUES (v_uid, v_company, auth.jwt()->>'email',
          coalesce(auth.jwt()->'user_metadata'->>'full_name', auth.jwt()->'user_metadata'->>'name', split_part(auth.jwt()->>'email','@',1)))
  RETURNING * INTO p;
  -- Roles are never self-assigned here; only an existing Super Admin grants roles.
  RETURN p;
END; $function$;