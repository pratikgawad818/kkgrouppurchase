-- Preserve source area precision; allow genuinely unpriced and undocumented built-up area.
DROP VIEW public.v_building_stats;
ALTER TABLE public.units
 ALTER COLUMN carpet_area TYPE numeric(11,3),
 ALTER COLUMN built_up_area TYPE numeric(11,3),
 ALTER COLUMN saleable_area TYPE numeric(11,3),
 ALTER COLUMN balcony_area TYPE numeric(11,3),
 ALTER COLUMN terrace_area TYPE numeric(11,3),
 ALTER COLUMN built_up_area DROP NOT NULL,
 ALTER COLUMN base_rate DROP NOT NULL,
 ADD COLUMN IF NOT EXISTS otla_area numeric(11,3) CHECK(otla_area>=0),
 ADD COLUMN IF NOT EXISTS pt_area numeric(11,3) CHECK(pt_area>=0);
-- With a missing built-up figure, still require total area >= carpet.
ALTER TABLE public.units ADD CONSTRAINT units_saleable_at_least_carpet CHECK(saleable_area>=carpet_area);
CREATE VIEW public.v_building_stats WITH (security_invoker = true) AS
SELECT b.id AS building_id, b.project_id,
  count(u.id) AS total_units,
  count(u.id) FILTER (WHERE u.status = 'available') AS available_units,
  count(u.id) FILTER (WHERE u.status = 'hold') AS hold_units,
  count(u.id) FILTER (WHERE u.status IN ('booked','agreement_pending')) AS booked_units,
  count(u.id) FILTER (WHERE u.status IN ('agreement_done','registered','possession_pending','possession_completed')) AS sold_units,
  count(u.id) FILTER (WHERE u.status = 'cancelled') AS withdrawn_units,
  coalesce(sum(u.saleable_area), 0) AS saleable_area,
  coalesce(sum(u.total_agreement_value) FILTER (WHERE u.status <> 'cancelled'), 0) AS inventory_value,
  coalesce(sum(u.total_agreement_value) FILTER (WHERE u.status IN ('available','hold')), 0) AS unsold_value
FROM public.buildings b LEFT JOIN public.units u ON u.building_id = b.id
GROUP BY b.id, b.project_id;
GRANT SELECT ON public.v_building_stats TO authenticated;
GRANT ALL ON public.v_building_stats TO service_role;
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

  IF NEW.base_rate IS NULL THEN
    IF NEW.status NOT IN ('available','hold','cancelled') OR NEW.booking_amount<>0 THEN RAISE EXCEPTION 'Set the list rate before booking'; END IF;
    NEW.base_price:=0; NEW.floor_rise_amount:=0; NEW.taxable_value:=0; NEW.gst_amount:=0; NEW.total_agreement_value:=0;
    RETURN NEW;
  END IF;

  -- Centralised pricing (numeric, rounded to paise)
  NEW.base_price := round(NEW.saleable_area * NEW.base_rate, 2);
  NEW.floor_rise_amount := round(NEW.saleable_area * NEW.floor_rise_rate, 2);
  NEW.taxable_value := NEW.base_price + NEW.floor_rise_amount + NEW.parking_charges + NEW.other_charges;
  NEW.gst_amount := round(NEW.taxable_value * NEW.gst_rate / 100, 2);
  NEW.total_agreement_value := NEW.taxable_value + NEW.gst_amount;
  IF NEW.booking_amount > NEW.total_agreement_value THEN
    RAISE EXCEPTION 'Booking amount cannot exceed the total agreement value.';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.sales_book_flat(_unit_id uuid, _name text, _mobile text, _price numeric, _booked_on date DEFAULT CURRENT_DATE, _email text DEFAULT NULL::text, _co_buyer text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_unit public.units%ROWTYPE;v_company uuid;v_id uuid;
BEGIN
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied';END IF;
 SELECT * INTO v_unit FROM public.units WHERE id=_unit_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(v_unit.project_id) THEN
   RAISE EXCEPTION 'Flat not accessible';END IF;
 IF v_unit.status<>'available' OR v_unit.record_status<>'active' THEN
   RAISE EXCEPTION 'This flat is not available';END IF;
 IF v_unit.base_rate IS NULL THEN RAISE EXCEPTION 'Set the list rate before booking'; END IF;
 SELECT company_id INTO v_company FROM public.projects WHERE id=v_unit.project_id;
 IF NOT public.actor_in_company(v_company) THEN RAISE EXCEPTION 'Company access denied';END IF;
 IF _booked_on IS NULL OR _booked_on>current_date THEN
   RAISE EXCEPTION 'Future booking date is not allowed';END IF;
 IF length(btrim(coalesce(_name,'')))<2 OR
    length(btrim(coalesce(_mobile,'')))<7 THEN
   RAISE EXCEPTION 'Buyer name and mobile are required';END IF;
 IF _price IS NULL OR _price<=0 OR _price>100000000000 THEN
   RAISE EXCEPTION 'Invalid final sale price';END IF;
 IF NOT public.sales_manager() AND _price<v_unit.total_agreement_value THEN
   RAISE EXCEPTION 'Discounted sale requires Director / Super Admin';END IF;
 INSERT INTO public.property_sales(company_id,project_id,unit_id,buyer_name,
   buyer_mobile,buyer_email,co_buyer_name,final_sale_price,
   list_price_at_booking,booked_on,notes,created_by)
 VALUES(v_company,v_unit.project_id,_unit_id,btrim(_name),btrim(_mobile),
   nullif(btrim(coalesce(_email,'')),''),
   nullif(btrim(coalesce(_co_buyer,'')),''),
   round(_price,2),v_unit.total_agreement_value,_booked_on,
   nullif(btrim(coalesce(_notes,'')),''),auth.uid())
 RETURNING id INTO v_id;
 PERFORM set_config('app.unit_status_source','sales',true);
 PERFORM set_config('app.unit_status_reason','Flat booked via Sales',true);
 UPDATE public.units SET status='booked'::public.unit_status WHERE id=_unit_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(v_id,'booked',jsonb_build_object('price',round(_price,2),
          'unit_id',_unit_id),auth.uid());
 RETURN v_id;
END $function$;

COMMENT ON COLUMN public.units.base_rate IS 'NULL means list price not configured; booking blocked until positive rate is set.';
COMMENT ON COLUMN public.units.built_up_area IS 'NULL means no verified built-up area supplied.';
COMMENT ON COLUMN public.units.otla_area IS 'Otla area as documented in source statement, square feet.';
COMMENT ON COLUMN public.units.pt_area IS 'P.T. area as labeled in source statement, square feet.';
