-- Auth changes its email only after the configured confirmation flow completes.
CREATE FUNCTION public.sync_verified_profile_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND (NEW.email IS DISTINCT FROM OLD.email OR OLD.email_confirmed_at IS NULL) THEN
    UPDATE public.profiles SET email=NEW.email WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_verified_profile_email() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_verified_profile_email AFTER UPDATE OF email,email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_verified_profile_email();
