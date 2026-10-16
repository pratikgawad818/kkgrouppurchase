-- Subscriptions can be registered only through the bounded, active-user RPC.
REVOKE INSERT,UPDATE ON public.push_subscriptions FROM authenticated;
DROP POLICY "Own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Read own push subscriptions" ON public.push_subscriptions FOR SELECT TO authenticated
  USING(user_id=auth.uid() AND public.is_active_user(auth.uid()));
CREATE POLICY "Remove own push subscriptions" ON public.push_subscriptions FOR DELETE TO authenticated USING(user_id=auth.uid());

CREATE FUNCTION public.register_my_push_subscription(_endpoint text,_p256dh text,_auth text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _endpoint IS NULL OR length(_endpoint)>4096 OR NOT (
    _endpoint ~ '^https://fcm[.]googleapis[.]com/(fcm/send|wp)/[^[:space:]#\\@]+'
    OR _endpoint ~ '^https://updates[.]push[.]services[.]mozilla[.]com/wpush/v[12]/[^[:space:]#\\@]+'
    OR _endpoint ~ '^https://web[.]push[.]apple[.]com/[^[:space:]#\\@]+'
    OR _endpoint ~ '^https://[a-z0-9-]+[.]notify[.]windows[.]com/w/[?][^[:space:]#\\@]+')
    OR _endpoint ~ '[[:space:]#\\]'
    OR coalesce(_p256dh,'') !~ '^[A-Za-z0-9_-]{87}=?$'
    OR coalesce(_auth,'') !~ '^[A-Za-z0-9_-]{22}(==)?$'
  THEN RAISE EXCEPTION 'Invalid push subscription'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('push:'||auth.uid()::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.push_subscriptions WHERE endpoint=_endpoint AND user_id=auth.uid())
    AND (SELECT count(*) FROM public.push_subscriptions WHERE user_id=auth.uid())>=10 THEN
    RAISE EXCEPTION 'This account already has 10 alert devices. Remove an old device first'; END IF;
  INSERT INTO public.push_subscriptions(user_id,endpoint,p256dh,auth) VALUES(auth.uid(),_endpoint,_p256dh,_auth)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth
      WHERE push_subscriptions.user_id=auth.uid() RETURNING id INTO changed;
  IF changed IS NULL THEN RAISE EXCEPTION 'Alerts on this device belong to another account. Turn them off in that account first'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.register_my_push_subscription(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_my_push_subscription(text,text,text) TO authenticated;

-- Updating a read flag must not allow rewriting the notification's title/link.
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE(is_read) ON public.notifications TO authenticated;
