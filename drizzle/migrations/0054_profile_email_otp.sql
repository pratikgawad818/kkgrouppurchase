-- OTP material is HMACed by the server. Neither tokens nor hashes are readable by staff.
CREATE TABLE public.profile_email_challenges (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  id uuid NOT NULL UNIQUE,
  old_email text NOT NULL,
  new_email text NOT NULL,
  old_hash text,
  new_hash text NOT NULL,
  old_verified boolean NOT NULL DEFAULT false,
  new_verified boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  sends integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (attempts BETWEEN 0 AND 5),
  CHECK (sends BETWEEN 1 AND 5)
);
ALTER TABLE public.profile_email_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_email_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.profile_email_challenges TO service_role;
--> statement-breakpoint
CREATE FUNCTION public.begin_profile_email_otp(_user_id uuid, _id uuid, _email text, _old_hash text, _new_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_address text; first_email boolean; previous public.profile_email_challenges; sends integer := 1; started timestamptz := now();
BEGIN
  SELECT lower(email) INTO old_address FROM auth.users WHERE id=_user_id FOR UPDATE;
  IF old_address IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=_user_id AND is_active AND company_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An active staff account is required';
  END IF;
  _email := lower(btrim(_email));
  IF length(_email)>255 OR _email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR _email LIKE '%@staff.kkgroup.local' OR _email=old_address THEN
    RAISE EXCEPTION 'Enter a different, valid email address';
  END IF;
  IF _old_hash !~ '^[a-f0-9]{64}$' OR _new_hash !~ '^[a-f0-9]{64}$' OR _old_hash IS NULL OR _new_hash IS NULL OR _id IS NULL THEN
    RAISE EXCEPTION 'Invalid verification request';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=_email AND id<>_user_id) THEN
    RAISE EXCEPTION 'That email address is already in use';
  END IF;
  SELECT * INTO previous FROM public.profile_email_challenges WHERE user_id=_user_id FOR UPDATE;
  IF FOUND AND previous.sent_at > now()-interval '60 seconds' THEN RAISE EXCEPTION 'Please wait 60 seconds before requesting new codes'; END IF;
  IF previous.window_started_at > now()-interval '1 hour' THEN
    IF previous.sends >= 5 THEN RAISE EXCEPTION 'Too many requests. Try again in an hour'; END IF;
    sends := previous.sends+1; started := previous.window_started_at;
  END IF;
  first_email := old_address LIKE '%@staff.kkgroup.local';
  INSERT INTO public.profile_email_challenges(user_id,id,old_email,new_email,old_hash,new_hash,old_verified,new_verified,attempts,sends,window_started_at,sent_at,expires_at,completed_at)
  VALUES(_user_id,_id,old_address,_email,CASE WHEN first_email THEN NULL ELSE _old_hash END,_new_hash,first_email,false,0,sends,started,now(),now()+interval '10 minutes',NULL)
  ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,old_email=excluded.old_email,new_email=excluded.new_email,old_hash=excluded.old_hash,new_hash=excluded.new_hash,
    old_verified=excluded.old_verified,new_verified=false,attempts=0,sends=excluded.sends,window_started_at=excluded.window_started_at,sent_at=excluded.sent_at,expires_at=excluded.expires_at,completed_at=NULL;
  RETURN jsonb_build_object('id',_id,'oldEmail',CASE WHEN first_email THEN NULL ELSE old_address END,'newEmail',_email,'oldVerified',first_email,'newVerified',false,'expiresAt',now()+interval '10 minutes','resendAt',now()+interval '60 seconds');
END $$;
REVOKE ALL ON FUNCTION public.begin_profile_email_otp(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_profile_email_otp(uuid,uuid,text,text,text) TO service_role;
--> statement-breakpoint
-- A single transaction verifies both inbox proofs and changes Auth + its email identity.
-- No privileged Auth update is performed outside this lock, avoiding first-email races.
CREATE FUNCTION public.verify_profile_email_otp(_user_id uuid, _id uuid, _side text, _hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_address text; challenge public.profile_email_challenges;
BEGIN
  SELECT lower(email) INTO current_address FROM auth.users WHERE id=_user_id FOR UPDATE;
  SELECT * INTO challenge FROM public.profile_email_challenges WHERE user_id=_user_id AND id=_id FOR UPDATE;
  IF NOT FOUND OR current_address IS DISTINCT FROM challenge.old_email OR challenge.completed_at IS NOT NULL OR challenge.expires_at<=now() OR challenge.attempts>=5 THEN
    RETURN jsonb_build_object('ok',false,'error','Codes expired or unavailable. Request new codes.');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=_user_id AND is_active AND company_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'error','Your staff account is inactive.');
  END IF;
  IF _side NOT IN ('old','new') OR _side IS NULL OR _hash IS NULL THEN RAISE EXCEPTION 'Invalid verification request'; END IF;
  IF (_side='old' AND (challenge.old_hash IS NULL OR _hash<>challenge.old_hash)) OR (_side='new' AND _hash<>challenge.new_hash) THEN
    UPDATE public.profile_email_challenges SET attempts=attempts+1 WHERE user_id=_user_id;
    RETURN jsonb_build_object('ok',false,'error',CASE WHEN challenge.attempts>=4 THEN 'Too many incorrect codes. Request new codes.' ELSE 'Incorrect code. Check the code in this inbox.' END);
  END IF;
  UPDATE public.profile_email_challenges SET old_verified=old_verified OR _side='old', new_verified=new_verified OR _side='new'
    WHERE user_id=_user_id RETURNING * INTO challenge;
  IF NOT(challenge.old_verified AND challenge.new_verified) THEN RETURN jsonb_build_object('ok',true,'complete',false,'oldVerified',challenge.old_verified,'newVerified',challenge.new_verified); END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=challenge.new_email AND id<>_user_id) THEN
    RETURN jsonb_build_object('ok',false,'error','That email address is already in use.');
  END IF;
  -- Supabase stores email identity data separately; preserve all other identity fields.
  UPDATE auth.identities SET identity_data=identity_data || jsonb_build_object('email',challenge.new_email,'email_verified',true),updated_at=now()
    WHERE user_id=_user_id AND provider='email';
  IF NOT FOUND THEN RAISE EXCEPTION 'Email sign-in identity not found. Contact your administrator'; END IF;
  UPDATE auth.users SET email=challenge.new_email,email_confirmed_at=now(),updated_at=now(),
    email_change='',email_change_token_current='',email_change_token_new='',email_change_confirm_status=0,email_change_sent_at=NULL
    WHERE id=_user_id;
  -- Auth's verified-email trigger synchronizes profiles; make the invariant explicit.
  UPDATE public.profiles SET email=challenge.new_email WHERE id=_user_id;
  INSERT INTO public.audit_logs(user_id,action,entity,entity_id,old_data,new_data)
    VALUES(_user_id,'email_verified','profiles',_user_id::text,jsonb_build_object('email',challenge.old_email),jsonb_build_object('email',challenge.new_email,'old_inbox_verified',challenge.old_hash IS NOT NULL,'new_inbox_verified',true));
  UPDATE public.profile_email_challenges SET completed_at=now(),old_hash=NULL,new_hash=repeat('0',64) WHERE user_id=_user_id;
  RETURN jsonb_build_object('ok',true,'complete',true,'oldVerified',true,'newVerified',true);
END $$;
REVOKE ALL ON FUNCTION public.verify_profile_email_otp(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_profile_email_otp(uuid,uuid,text,text) TO service_role;
