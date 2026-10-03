CREATE OR REPLACE FUNCTION public.vq_after_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total int; responded int; st rfq_status; prev text;
BEGIN
  IF NEW.status IN ('selected','rejected') THEN RETURN NULL; END IF;
  IF NEW.status = 'submitted' THEN
    UPDATE rfq_vendors SET status = 'responded', responded_at = coalesce(responded_at, now()) WHERE id = NEW.rfq_vendor_id;
  END IF;
  SELECT status INTO st FROM rfqs WHERE id = NEW.rfq_id;
  IF st IN ('sent','partially_responded','fully_responded') THEN
    SELECT count(*), count(*) FILTER (WHERE status <> 'pending') INTO total, responded FROM rfq_vendors WHERE rfq_id = NEW.rfq_id;
    prev := coalesce(current_setting('app.rfq_source', true),'');
    PERFORM set_config('app.rfq_source','rpc',true);
    UPDATE rfqs SET status = CASE WHEN responded >= total THEN 'fully_responded'::rfq_status
      WHEN responded > 0 THEN 'partially_responded'::rfq_status ELSE 'sent'::rfq_status END
    WHERE id = NEW.rfq_id;
    PERFORM set_config('app.rfq_source',prev,true);
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.vq_after_write() FROM PUBLIC, anon, authenticated;