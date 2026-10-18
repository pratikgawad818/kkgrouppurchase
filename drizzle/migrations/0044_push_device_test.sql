-- A self-test is rate limited per owned subscription by the authenticated server function.
-- Existing row policies and client write privileges remain unchanged.
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS last_test_at timestamptz;

-- Dispatch may need two five-second provider attempts; the caller must not abandon it early.
CREATE OR REPLACE FUNCTION public.notifications_push_dispatch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE c public.push_config;
BEGIN
  SELECT * INTO c FROM public.push_config WHERE id = 1;
  IF c.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    url := c.dispatch_url,
    body := jsonb_build_object('id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', c.dispatch_secret),
    timeout_milliseconds := 15000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notifications_push_dispatch() FROM PUBLIC, anon, authenticated;
