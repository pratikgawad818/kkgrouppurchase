-- 0095: Super Admin-only correction of erroneously advanced sales stages.
-- NOT a legal cancellation or de-registration. No payment records are deleted
-- and records with received/reported money are not eligible for correction.

CREATE OR REPLACE FUNCTION public.sales_correct_erroneous_stage(
  _sale_id uuid,
  _reason text,
  _confirmation text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp'
AS $$
DECLARE s public.property_sales%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid())
     OR NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only an active Super Admin can correct an erroneously advanced booking';
  END IF;
  SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
  IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id)
     OR NOT public.actor_in_company(s.company_id) THEN
    RAISE EXCEPTION 'Booking not found in an accessible project';
  END IF;
  IF s.status NOT IN ('agreement_pending','agreement_done','registered','possession_pending') THEN
    RAISE EXCEPTION 'Only an open booking advanced in error can be corrected';
  END IF;
  IF _confirmation IS DISTINCT FROM 'I_CONFIRM_STAGE_ENTERED_IN_ERROR' THEN
    RAISE EXCEPTION 'Confirm that this booking stage was entered in error';
  END IF;
  IF length(btrim(coalesce(_reason,'')))<20 THEN
    RAISE EXCEPTION 'Describe the clerical mistake in at least 20 characters';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.property_sale_receipts r
    WHERE r.sale_id=s.id AND r.status IN ('reported','verified')
  ) OR EXISTS(
    SELECT 1 FROM public.property_sale_cancellations c WHERE c.sale_id=s.id
  ) THEN
    RAISE EXCEPTION 'Sales with customer funds or cancellation history require formal legal and accounts review';
  END IF;
  PERFORM 1 FROM public.units u WHERE u.id=s.unit_id
    AND u.status=s.status::public.unit_status FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Flat status and sale stage do not match'; END IF;
  UPDATE public.property_sales SET status='booked',updated_at=now() WHERE id=s.id;
  PERFORM set_config('app.unit_status_source','sales',true);
  PERFORM set_config('app.unit_status_reason','Clerical sale stage correction',true);
  UPDATE public.units SET status='booked'::public.unit_status WHERE id=s.unit_id;
  INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
  VALUES(s.id,'stage_corrected',jsonb_build_object(
    'previous_stage',s.status,'corrected_stage','booked',
    'reason',btrim(_reason),'verified_no_payments',true),auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.sales_correct_erroneous_stage(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_correct_erroneous_stage(uuid,text,text) TO authenticated;
