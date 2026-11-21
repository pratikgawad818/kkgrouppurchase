-- 0094: Bulk flat onboarding and project/building sales summary.
-- Reuse the existing units master and its valuation/duplicate guards.

CREATE INDEX IF NOT EXISTS units_sales_project_building_status_idx
 ON public.units(project_id,building_id,status,unit_number)
 WHERE record_status='active';
CREATE INDEX IF NOT EXISTS property_sales_booked_on_idx
 ON public.property_sales(project_id,booked_on DESC,id);
CREATE INDEX IF NOT EXISTS property_sales_buyer_search_idx
 ON public.property_sales(project_id,lower(buyer_name));
CREATE INDEX IF NOT EXISTS property_sale_receipts_created_idx
 ON public.property_sale_receipts(sale_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.sales_bulk_add_flats(
 _building_id uuid,_floor_ids uuid[],_per_floor integer,_start_at integer,
 _digits integer,_separator text,_type public.unit_type,
 _carpet numeric,_built_up numeric,_saleable numeric,_rate numeric,
 _parking numeric DEFAULT 0,_other numeric DEFAULT 0,_gst numeric DEFAULT 5
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE project_id uuid;company_id uuid; floor_count integer; generated integer;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT b.project_id,p.company_id INTO project_id,company_id
 FROM public.buildings b JOIN public.projects p ON p.id=b.project_id
 WHERE b.id=_building_id;
 IF project_id IS NULL OR NOT public.sales_project_allowed(project_id)
    OR NOT public.actor_in_company(company_id) THEN
   RAISE EXCEPTION 'Building is not accessible'; END IF;
 IF _floor_ids IS NULL OR array_length(_floor_ids,1) NOT BETWEEN 1 AND 80
   OR _per_floor NOT BETWEEN 1 AND 50 OR _start_at NOT BETWEEN 0 AND 999
   OR _digits NOT BETWEEN 1 AND 4 OR _separator !~ '^[A-Za-z0-9-]{0,3}$' THEN
   RAISE EXCEPTION 'Select floors and valid flat numbering options'; END IF;
 IF _carpet IS NULL OR _carpet<=0 OR _built_up<_carpet OR _saleable<_built_up
   OR _rate IS NULL OR _rate<=0 OR _parking<0 OR _other<0 OR _gst NOT BETWEEN 0 AND 28 THEN
   RAISE EXCEPTION 'Enter valid areas, rate and charges'; END IF;
 IF cardinality(_floor_ids)*_per_floor>1200 THEN
   RAISE EXCEPTION 'Create at most 1200 flats in one batch'; END IF;
 SELECT count(*) INTO floor_count FROM public.floors f
 WHERE f.id=ANY(_floor_ids) AND f.building_id=_building_id;
 IF floor_count IS DISTINCT FROM cardinality(_floor_ids)
 OR floor_count IS DISTINCT FROM (SELECT count(DISTINCT u) FROM unnest(_floor_ids) u) THEN
   RAISE EXCEPTION 'All selected floors must be distinct and belong to this building'; END IF;
 IF _start_at+_per_floor-1>9999 THEN
   RAISE EXCEPTION 'Flat number exceeds allowed range'; END IF;
 -- Any duplicate flat number aborts the entire transaction; never silently
 -- overwrite a booked flat or create only some rows in a batch.
 INSERT INTO public.units(project_id,building_id,floor_id,unit_number,unit_type,
   carpet_area,built_up_area,saleable_area,base_rate,parking_charges,other_charges,gst_rate,status)
 SELECT project_id,_building_id,f.id,
   f.floor_number::text||_separator||lpad(i::text,_digits,'0'),_type,
   _carpet,_built_up,_saleable,_rate,coalesce(_parking,0),coalesce(_other,0),
   coalesce(_gst,5),'available'::public.unit_status
 FROM public.floors f
 CROSS JOIN LATERAL generate_series(_start_at,_start_at+_per_floor-1) i
 WHERE f.id=ANY(_floor_ids) AND f.building_id=_building_id;
 GET DIAGNOSTICS generated=ROW_COUNT;
 IF generated<>floor_count*_per_floor THEN
   RAISE EXCEPTION 'Bulk flat count mismatch; no changes committed'; END IF;
 RETURN generated;
END $$;
REVOKE ALL ON FUNCTION public.sales_bulk_add_flats(uuid,uuid[],integer,integer,integer,text,public.unit_type,numeric,numeric,numeric,numeric,numeric,numeric,numeric)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_bulk_add_flats(uuid,uuid[],integer,integer,integer,text,public.unit_type,numeric,numeric,numeric,numeric,numeric,numeric,numeric)
 TO authenticated;

-- Values derive from real receipts and verified refunds, never from unverified
-- payment reports. All source rows are individually sales-project scoped.
CREATE OR REPLACE FUNCTION public.sales_overview(
 _project uuid DEFAULT NULL,_building uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
 WITH accessible_flats AS (
  SELECT u.id,u.project_id,u.building_id,u.status
  FROM public.units u
  WHERE u.record_status='active'
    AND public.sales_project_allowed(u.project_id)
    AND (_project IS NULL OR u.project_id=_project)
    AND (_building IS NULL OR u.building_id=_building)
 ), eligible_sales AS (
  SELECT s.id,s.final_sale_price,s.status
  FROM public.property_sales s JOIN accessible_flats u ON u.id=s.unit_id
 ), receipts AS (
  SELECT r.sale_id,coalesce(sum(r.amount),0) paid
  FROM public.property_sale_receipts r
  JOIN eligible_sales s ON s.id=r.sale_id
  WHERE r.status='verified' GROUP BY r.sale_id
 ), liabilities AS (
  SELECT c.sale_id,greatest(0,c.refund_due-coalesce(sum(ref.amount),0)) pending
  FROM public.property_sale_cancellations c
  JOIN eligible_sales s ON s.id=c.sale_id
  LEFT JOIN public.property_sale_refunds ref ON ref.cancellation_id=c.id
  GROUP BY c.sale_id,c.refund_due
 )
 SELECT jsonb_build_object(
  'total_flats',(SELECT count(*) FROM accessible_flats),
  'available_flats',(SELECT count(*) FROM accessible_flats WHERE status='available'),
  'booked_flats',(SELECT count(*) FROM accessible_flats WHERE status NOT IN ('available','hold')),
  'active_sales',(SELECT count(*) FROM eligible_sales WHERE status<>'cancelled'),
  'cancelled_sales',(SELECT count(*) FROM eligible_sales WHERE status='cancelled'),
  'verified_collections',(SELECT coalesce(sum(r.paid),0) FROM receipts r
      JOIN eligible_sales s ON s.id=r.sale_id WHERE s.status<>'cancelled'),
  'outstanding',(SELECT coalesce(sum(greatest(0,s.final_sale_price-coalesce(r.paid,0))),0)
      FROM eligible_sales s LEFT JOIN receipts r ON r.sale_id=s.id WHERE s.status<>'cancelled'),
  'refund_pending',(SELECT coalesce(sum(pending),0) FROM liabilities)
 );
$$;
REVOKE ALL ON FUNCTION public.sales_overview(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_overview(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sales_booking_finances(_sale_ids uuid[])
RETURNS TABLE(
 sale_id uuid,verified_paid numeric,reported_pending numeric,
 refund_due numeric,refund_paid numeric,cancellation_reason text,
 pending_cancel_request_id uuid,pending_cancel_reason text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT s.id,
   coalesce(received.verified_paid,0),
   coalesce(received.reported_pending,0),
   coalesce(c.refund_due,0),
   coalesce(refunded.refund_paid,0),
   c.reason,
   request.id,request.reason
 FROM public.property_sales s
 LEFT JOIN LATERAL (
   SELECT sum(r.amount) FILTER(WHERE r.status='verified') AS verified_paid,
          sum(r.amount) FILTER(WHERE r.status='reported') AS reported_pending
   FROM public.property_sale_receipts r WHERE r.sale_id=s.id
 ) received ON true
 LEFT JOIN public.property_sale_cancellations c ON c.sale_id=s.id
 LEFT JOIN LATERAL(
   SELECT sum(r.amount) AS refund_paid
   FROM public.property_sale_refunds r WHERE r.cancellation_id=c.id
 ) refunded ON true
 LEFT JOIN LATERAL(
   SELECT id,reason FROM public.property_sale_cancel_requests
   WHERE sale_id=s.id AND status='pending' ORDER BY requested_at DESC LIMIT 1
 ) request ON true
 WHERE s.id=ANY(_sale_ids)
 AND public.sales_project_allowed(s.project_id)
 AND _sale_ids IS NOT NULL AND cardinality(_sale_ids) BETWEEN 1 AND 50;
$$;
REVOKE ALL ON FUNCTION public.sales_booking_finances(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_booking_finances(uuid[]) TO authenticated;
