-- 0098: project/building commercial reporting and legal-stage integrity.
CREATE OR REPLACE FUNCTION public.sales_project_report(_project uuid DEFAULT NULL)
RETURNS TABLE(
 project_id uuid,project_name text,building_id uuid,building_name text,
 flats bigint,available bigint,active_bookings bigint,
 contracted_value numeric,verified_collections numeric,buyer_outstanding numeric,refund_pending numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH buildings_accessible AS (
  SELECT b.id,b.name,b.project_id,p.name AS project_name
  FROM public.buildings b JOIN public.projects p ON p.id=b.project_id
  WHERE public.sales_project_allowed(b.project_id)
  AND public.actor_in_company(p.company_id)
  AND (_project IS NULL OR b.project_id=_project)
 ), properties AS (
  SELECT u.id,u.building_id,u.status
  FROM public.units u JOIN buildings_accessible b ON b.id=u.building_id
  WHERE u.record_status='active'
 ), receipts AS (
  SELECT r.sale_id,coalesce(sum(r.amount),0) paid
  FROM public.property_sale_receipts r JOIN public.property_sales s ON s.id=r.sale_id
  JOIN properties u ON u.id=s.unit_id
  WHERE r.status='verified' GROUP BY r.sale_id
 ), refunds AS (
  SELECT c.sale_id,greatest(0,c.refund_due-coalesce(sum(ref.amount),0)) outstanding_refund
  FROM public.property_sale_cancellations c
  JOIN public.property_sales s ON s.id=c.sale_id JOIN properties u ON u.id=s.unit_id
  LEFT JOIN public.property_sale_refunds ref ON ref.cancellation_id=c.id
  GROUP BY c.sale_id,c.refund_due
 ), sale_rollup AS (
  SELECT u.building_id,s.id,s.status,s.final_sale_price,
  coalesce(r.paid,0) paid,coalesce(ref.outstanding_refund,0) refund_due
  FROM public.property_sales s JOIN properties u ON u.id=s.unit_id
  LEFT JOIN receipts r ON r.sale_id=s.id
  LEFT JOIN refunds ref ON ref.sale_id=s.id
 ), property_counts AS (
  SELECT building_id,count(*) flats,count(*) FILTER (WHERE status='available') available
  FROM properties GROUP BY building_id
 ), sale_counts AS (
  SELECT building_id,
   count(*) FILTER (WHERE status<>'cancelled') active_bookings,
   coalesce(sum(final_sale_price) FILTER (WHERE status<>'cancelled'),0) contracted_value,
   coalesce(sum(paid) FILTER (WHERE status<>'cancelled'),0) verified_collections,
   coalesce(sum(greatest(0,final_sale_price-paid)) FILTER (WHERE status<>'cancelled'),0) buyer_outstanding,
   coalesce(sum(refund_due),0) refund_pending
  FROM sale_rollup GROUP BY building_id
 )
 SELECT b.project_id,b.project_name,b.id,b.name,
 coalesce(p.flats,0),coalesce(p.available,0),coalesce(s.active_bookings,0),
 coalesce(s.contracted_value,0),coalesce(s.verified_collections,0),
 coalesce(s.buyer_outstanding,0),coalesce(s.refund_pending,0)
 FROM buildings_accessible b
 LEFT JOIN property_counts p ON p.building_id=b.id
 LEFT JOIN sale_counts s ON s.building_id=b.id
 ORDER BY b.project_name,b.name;
$$;
REVOKE ALL ON FUNCTION public.sales_project_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_project_report(uuid) TO authenticated;

-- Do not silently mark an agreement signed or property registered without
-- recording the corresponding document references and real dates.
CREATE OR REPLACE FUNCTION public.sales_set_stage(
 _sale_id uuid,_status text,_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE;nxt text;paid numeric;legal public.property_sale_legal_details%ROWTYPE;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id)
    OR NOT public.actor_in_company(s.company_id) THEN
   RAISE EXCEPTION 'Sale not accessible'; END IF;
 IF s.status IN ('cancelled','possession_completed') THEN RAISE EXCEPTION 'Finalized sale cannot change stage'; END IF;
 nxt:=CASE s.status
  WHEN 'booked' THEN 'agreement_pending'
  WHEN 'agreement_pending' THEN 'agreement_done'
  WHEN 'agreement_done' THEN 'registered'
  WHEN 'registered' THEN 'possession_pending'
  WHEN 'possession_pending' THEN 'possession_completed'
  ELSE NULL END;
 IF _status IS DISTINCT FROM nxt THEN
    RAISE EXCEPTION 'Invalid stage; cancellation has its own approval workflow'; END IF;
 IF _status IN ('agreement_done','registered','possession_pending','possession_completed') THEN
  SELECT * INTO legal FROM public.property_sale_legal_details WHERE sale_id=_sale_id;
  IF legal.agreement_date IS NULL OR length(btrim(coalesce(legal.agreement_number,'')))<3 THEN
   RAISE EXCEPTION 'Record signed agreement details before advancing'; END IF;
 END IF;
 IF _status IN ('registered','possession_pending','possession_completed') THEN
  IF legal.registration_date IS NULL OR length(btrim(coalesce(legal.registration_number,'')))<3 THEN
    RAISE EXCEPTION 'Record registration details before advancing'; END IF;
 END IF;
 IF _status='possession_completed' THEN
  IF EXISTS(SELECT 1 FROM public.property_sale_receipts
    WHERE sale_id=_sale_id AND status='reported') THEN
     RAISE EXCEPTION 'Pending receipt verification must be resolved'; END IF;
  SELECT coalesce(sum(r.amount),0) INTO paid FROM public.property_sale_receipts r
   WHERE r.sale_id=_sale_id AND r.status='verified';
  IF paid<s.final_sale_price THEN RAISE EXCEPTION 'Full payment verification required'; END IF;
 END IF;
 UPDATE public.property_sales SET status=_status,updated_at=now() WHERE id=_sale_id;
 PERFORM set_config('app.unit_status_source','sales',true);
 PERFORM set_config('app.unit_status_reason','Sale stage update',true);
 UPDATE public.units SET status=_status::public.unit_status WHERE id=s.unit_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'stage_advanced',jsonb_build_object('from',s.status,'to',_status,'reason',_reason),auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.sales_set_stage(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_set_stage(uuid,text,text) TO authenticated;

-- Stage correction is not permissible if a legal record now contradicts
-- the operator's declaration that nothing was legally executed/registered.
CREATE OR REPLACE FUNCTION public.sales_correct_erroneous_stage(
 _sale_id uuid,_reason text,_confirmation text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid())
  OR NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only Super Admin may correct an erroneous stage'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id)
  OR NOT public.actor_in_company(s.company_id) THEN RAISE EXCEPTION 'Sale not accessible'; END IF;
 IF s.status NOT IN ('agreement_pending','agreement_done','registered','possession_pending') THEN
  RAISE EXCEPTION 'Only eligible open bookings may be corrected'; END IF;
 IF _confirmation IS DISTINCT FROM 'I_CONFIRM_STAGE_ENTERED_IN_ERROR'
  OR length(btrim(coalesce(_reason,'')))<20 THEN
  RAISE EXCEPTION 'Explicit confirmation and a 20-character correction reason required'; END IF;
 IF EXISTS(SELECT 1 FROM public.property_sale_receipts r
   WHERE r.sale_id=s.id AND r.status IN ('reported','verified'))
 OR EXISTS(SELECT 1 FROM public.property_sale_cancellations c WHERE c.sale_id=s.id)
 OR EXISTS(SELECT 1 FROM public.property_sale_legal_details l WHERE l.sale_id=s.id
   AND (l.agreement_date IS NOT NULL OR l.registration_date IS NOT NULL)) THEN
  RAISE EXCEPTION 'Financial or legal record exists; use a formal reversal'; END IF;
 PERFORM 1 FROM public.units u WHERE u.id=s.unit_id
  AND u.status=s.status::public.unit_status FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Flat status does not match the booking'; END IF;
 UPDATE public.property_sales SET status='booked',updated_at=now() WHERE id=s.id;
 PERFORM set_config('app.unit_status_source','sales',true);
 PERFORM set_config('app.unit_status_reason','Clerical sale stage correction',true);
 UPDATE public.units SET status='booked'::public.unit_status WHERE id=s.unit_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(s.id,'stage_corrected',jsonb_build_object('previous_stage',s.status,
 'corrected_stage','booked','reason',btrim(_reason)),auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.sales_correct_erroneous_stage(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_correct_erroneous_stage(uuid,text,text) TO authenticated;
