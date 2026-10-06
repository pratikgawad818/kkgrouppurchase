CREATE OR REPLACE FUNCTION public.grn_date_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.received_date IS DISTINCT FROM OLD.received_date) AND NEW.received_date > public.ist_today() THEN
    RAISE EXCEPTION 'Received date cannot be in the future';
  END IF;
  RETURN NEW;
END $$;