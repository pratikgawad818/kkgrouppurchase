-- City Centre inventory ownership and historical status, independent of Supreme Park.
ALTER TABLE public.units
 ADD COLUMN ownership_type text NOT NULL DEFAULT 'builder' CHECK(ownership_type IN ('builder','landowner','investor')),
 ADD COLUMN legacy_sale_status text CHECK(legacy_sale_status IN ('sold','booked')),
 ADD COLUMN source_layout text,
 ADD COLUMN source_area_details jsonb,
 ADD COLUMN pricing_model text NOT NULL DEFAULT 'standard' CHECK(pricing_model IN ('standard','city_centre_workbook')),
 ADD COLUMN stamp_duty_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK(stamp_duty_rate BETWEEN 0 AND 100),
 ADD COLUMN stamp_duty_amount numeric(16,2) NOT NULL DEFAULT 0 CHECK(stamp_duty_amount>=0),
 ADD COLUMN registration_fee numeric(16,2) NOT NULL DEFAULT 0 CHECK(registration_fee>=0);
ALTER TABLE public.units ADD CONSTRAINT units_non_saleable_status CHECK((ownership_type='builder' AND legacy_sale_status IS NULL) OR status='hold');
CREATE OR REPLACE FUNCTION public.units_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_building uuid; v_project uuid; v_src text := coalesce(current_setting('app.unit_status_source', true), '');
BEGIN
  SELECT f.building_id, b.project_id INTO v_building, v_project
  FROM public.floors f JOIN public.buildings b ON b.id = f.building_id WHERE f.id = NEW.floor_id;
  IF v_building IS NULL THEN RAISE EXCEPTION 'Selected floor does not exist.'; END IF;
  NEW.building_id := v_building;
  NEW.project_id := v_project;

  IF NEW.ownership_type <> 'builder' OR NEW.legacy_sale_status IS NOT NULL THEN
    IF NEW.status <> 'hold' THEN RAISE EXCEPTION 'Third-party or historical inventory is not available for a new booking'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ownership_type IS DISTINCT FROM NEW.ownership_type OR OLD.legacy_sale_status IS DISTINCT FROM NEW.legacy_sale_status THEN
      RAISE EXCEPTION 'Ownership and historical status require a reconciled management workflow';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('available','hold') THEN
      RAISE EXCEPTION 'New units can only be created as Available or Hold.';
    END IF;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('booked','agreement_pending','agreement_done','registered','possession_pending','possession_completed')
         AND v_src <> 'sales' THEN
        RAISE EXCEPTION 'Unit % can only move to % through a booking record.', OLD.unit_number, NEW.status;
      END IF;
      IF v_src NOT IN ('rpc','sales') THEN
        RAISE EXCEPTION 'Unit status must be changed through the status workflow, not by direct edit.';
      END IF;
    END IF;
    IF OLD.status NOT IN ('available','hold','cancelled') AND (
         NEW.saleable_area IS DISTINCT FROM OLD.saleable_area OR NEW.base_rate IS DISTINCT FROM OLD.base_rate OR
         NEW.floor_rise_rate IS DISTINCT FROM OLD.floor_rise_rate OR NEW.parking_charges IS DISTINCT FROM OLD.parking_charges OR
         NEW.other_charges IS DISTINCT FROM OLD.other_charges OR NEW.gst_rate IS DISTINCT FROM OLD.gst_rate) THEN
      RAISE EXCEPTION 'Pricing for unit % is locked because it has an active booking.', OLD.unit_number;
    END IF;
  END IF;

  IF NEW.status <> 'hold' THEN NEW.hold_until := NULL; NEW.hold_reason := NULL; END IF;

  -- Centralised pricing (numeric, rounded to paise)
  NEW.base_price := round(NEW.saleable_area * NEW.base_rate, 2);
  NEW.floor_rise_amount := round(NEW.saleable_area * NEW.floor_rise_rate, 2);
  NEW.taxable_value := NEW.base_price + NEW.floor_rise_amount + NEW.parking_charges + NEW.other_charges;
  IF NEW.pricing_model = 'city_centre_workbook' THEN
    NEW.gst_amount := round(NEW.base_price * NEW.gst_rate / 100, 2);
    NEW.stamp_duty_amount := round(NEW.base_price * NEW.stamp_duty_rate / 100, 2);
    NEW.total_agreement_value := NEW.taxable_value + NEW.gst_amount + NEW.stamp_duty_amount + NEW.registration_fee;
  ELSE
    NEW.gst_amount := round(NEW.taxable_value * NEW.gst_rate / 100, 2);
    NEW.stamp_duty_amount := 0;
    NEW.total_agreement_value := NEW.taxable_value + NEW.gst_amount;
  END IF;
  IF NEW.booking_amount > NEW.total_agreement_value THEN
    RAISE EXCEPTION 'Booking amount cannot exceed the total agreement value.';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.sales_overview(_project uuid DEFAULT NULL::uuid, _building uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH accessible_flats AS (
  SELECT u.id,u.project_id,u.building_id,u.status,u.ownership_type,u.legacy_sale_status
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
  'available_flats',(SELECT count(*) FROM accessible_flats WHERE ownership_type='builder' AND legacy_sale_status IS NULL AND status='available'),
  'third_party_flats',(SELECT count(*) FROM accessible_flats WHERE ownership_type<>'builder'),
  'legacy_sold_flats',(SELECT count(*) FROM accessible_flats WHERE ownership_type='builder' AND legacy_sale_status='sold'),
  'legacy_booked_flats',(SELECT count(*) FROM accessible_flats WHERE ownership_type='builder' AND legacy_sale_status='booked'),
  'booked_flats',(SELECT count(*) FROM accessible_flats WHERE ownership_type='builder' AND (status NOT IN ('available','hold') OR legacy_sale_status IS NOT NULL)),
  'active_sales',(SELECT count(*) FROM eligible_sales WHERE status<>'cancelled'),
  'cancelled_sales',(SELECT count(*) FROM eligible_sales WHERE status='cancelled'),
  'verified_collections',(SELECT coalesce(sum(r.paid),0) FROM receipts r
      JOIN eligible_sales s ON s.id=r.sale_id WHERE s.status<>'cancelled'),
  'outstanding',(SELECT coalesce(sum(greatest(0,s.final_sale_price-coalesce(r.paid,0))),0)
      FROM eligible_sales s LEFT JOIN receipts r ON r.sale_id=s.id WHERE s.status<>'cancelled'),
  'refund_pending',(SELECT coalesce(sum(pending),0) FROM liabilities)
 );
$function$;

-- No fabricated sale or receipt rows; preserve status in legacy_sale_status until reconciliation.
CREATE OR REPLACE VIEW public.v_building_stats WITH (security_invoker=true) AS
SELECT b.id AS building_id,b.project_id,count(u.id) AS total_units,
 count(u.id) FILTER(WHERE u.status='available' AND u.ownership_type='builder' AND u.legacy_sale_status IS NULL) AS available_units,
 count(u.id) FILTER(WHERE u.status='hold' AND u.ownership_type='builder' AND u.legacy_sale_status IS NULL) AS hold_units,
 count(u.id) FILTER(WHERE u.ownership_type='builder' AND (u.status IN ('booked','agreement_pending') OR u.legacy_sale_status='booked')) AS booked_units,
 count(u.id) FILTER(WHERE u.ownership_type='builder' AND (u.status IN ('agreement_done','registered','possession_pending','possession_completed') OR u.legacy_sale_status='sold')) AS sold_units,
 count(u.id) FILTER(WHERE u.status='cancelled') AS withdrawn_units,
 coalesce(sum(u.saleable_area),0) AS saleable_area,
 coalesce(sum(u.total_agreement_value) FILTER(WHERE u.ownership_type='builder' AND u.status<>'cancelled'),0) AS inventory_value,
 coalesce(sum(u.total_agreement_value) FILTER(WHERE u.ownership_type='builder' AND u.legacy_sale_status IS NULL AND u.status IN ('available','hold')),0) AS unsold_value,
 count(u.id) FILTER(WHERE u.ownership_type<>'builder') AS third_party_units
FROM public.buildings b LEFT JOIN public.units u ON u.building_id=b.id GROUP BY b.id,b.project_id;
