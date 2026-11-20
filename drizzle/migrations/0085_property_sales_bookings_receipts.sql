-- 0085: Sales is a separate business module using the existing public.units master.
-- Requires enum migration 0084 in a previous committed transaction.
-- Approved purchase, inventory stock and vendor finance records are untouched.
INSERT INTO public.role_permissions (role,permission_code)
VALUES
 ('senior_sales_executive'::public.app_role,'units.view'),
 ('senior_sales_executive'::public.app_role,'sales.bookings'),
 ('senior_sales_executive'::public.app_role,'sales.collections')
ON CONFLICT DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS public.property_sale_no_seq;

CREATE TABLE IF NOT EXISTS public.property_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_number text NOT NULL UNIQUE DEFAULT
   ('SALE-' || to_char(current_date,'YYYY') || '-' ||
    lpad(nextval('public.property_sale_no_seq')::text,6,'0')),
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
 unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
 buyer_name text NOT NULL CHECK(length(btrim(buyer_name)) BETWEEN 2 AND 180),
 buyer_mobile text NOT NULL CHECK(length(btrim(buyer_mobile)) BETWEEN 7 AND 20),
 buyer_email text,
 co_buyer_name text,
 final_sale_price numeric(16,2) NOT NULL CHECK(final_sale_price>0),
 list_price_at_booking numeric(16,2) NOT NULL CHECK(list_price_at_booking>0),
 booked_on date NOT NULL DEFAULT current_date,
 status text NOT NULL DEFAULT 'booked'
  CHECK(status IN ('booked','agreement_pending','agreement_done',
                   'registered','possession_pending','possession_completed','cancelled')),
 notes text,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS property_sales_one_active_unit
 ON public.property_sales(unit_id) WHERE status<>'cancelled';
CREATE INDEX IF NOT EXISTS property_sales_project_idx
 ON public.property_sales(project_id,status);

CREATE TABLE IF NOT EXISTS public.property_sale_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_id uuid NOT NULL REFERENCES public.property_sales(id) ON DELETE RESTRICT,
 amount numeric(16,2) NOT NULL CHECK(amount>0),
 paid_on date NOT NULL,
 method text NOT NULL CHECK(method IN ('cash','upi','neft','rtgs','imps','cheque','card','other')),
 reference text,
 payer_name text,
 notes text,
 status text NOT NULL DEFAULT 'reported'
  CHECK(status IN ('reported','verified','rejected')),
 reviewer_note text,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 reviewed_by uuid REFERENCES public.profiles(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT property_receipt_review_consistency CHECK(
  (status='reported' AND reviewed_by IS NULL AND reviewed_at IS NULL)
  OR (status IN ('verified','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
 )
);
CREATE UNIQUE INDEX IF NOT EXISTS property_sale_receipts_reference_idx
 ON public.property_sale_receipts(sale_id,method,lower(reference))
 WHERE reference IS NOT NULL AND status<>'rejected';
CREATE INDEX IF NOT EXISTS property_sale_receipts_sale_idx
 ON public.property_sale_receipts(sale_id,status);

CREATE TABLE IF NOT EXISTS public.property_sale_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_id uuid NOT NULL REFERENCES public.property_sales(id) ON DELETE RESTRICT,
 action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.property_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_sale_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_sale_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_sales, public.property_sale_receipts,
 public.property_sale_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.property_sales, public.property_sale_receipts,
 public.property_sale_events TO authenticated;

CREATE OR REPLACE FUNCTION public.sales_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
 SELECT auth.uid() IS NOT NULL AND public.is_active_user(auth.uid()) AND
   (public.has_role(auth.uid(),'super_admin'::public.app_role)
    OR public.has_role(auth.uid(),'director'::public.app_role)
    OR public.has_role(auth.uid(),'senior_sales_executive'::public.app_role));
$$;
CREATE OR REPLACE FUNCTION public.sales_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
 SELECT public.sales_allowed() AND
   (public.has_role(auth.uid(),'super_admin'::public.app_role)
    OR public.has_role(auth.uid(),'director'::public.app_role));
$$;
CREATE OR REPLACE FUNCTION public.sales_project_allowed(_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
 SELECT public.sales_allowed() AND public.can_access_project(auth.uid(),_project);
$$;

CREATE POLICY "Accessible property sales" ON public.property_sales
 FOR SELECT TO authenticated USING (public.sales_project_allowed(project_id));
CREATE POLICY "Accessible sale receipts" ON public.property_sale_receipts
 FOR SELECT TO authenticated USING(
  EXISTS(SELECT 1 FROM public.property_sales s
         WHERE s.id=sale_id AND public.sales_project_allowed(s.project_id)));
CREATE POLICY "Accessible sale activity" ON public.property_sale_events
 FOR SELECT TO authenticated USING(
  EXISTS(SELECT 1 FROM public.property_sales s
         WHERE s.id=sale_id AND public.sales_project_allowed(s.project_id)));

-- A sales user cannot edit the unit master. The manager creates a flat once,
-- from the same public.units table used by the legacy inventory route.
CREATE OR REPLACE FUNCTION public.sales_add_flat(
 _floor_id uuid,_number text,_type public.unit_type,
 _carpet numeric,_built_up numeric,_saleable numeric,_rate numeric,
 _parking numeric DEFAULT 0,_other numeric DEFAULT 0,_gst numeric DEFAULT 5
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_project uuid;v_id uuid;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only';END IF;
 SELECT b.project_id INTO v_project FROM public.floors f
 JOIN public.buildings b ON b.id=f.building_id WHERE f.id=_floor_id;
 IF v_project IS NULL OR NOT public.sales_project_allowed(v_project) THEN
   RAISE EXCEPTION 'Floor not accessible';END IF;
 IF length(btrim(coalesce(_number,''))) NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'Flat number is required';END IF;
 INSERT INTO public.units(project_id,building_id,floor_id,unit_number,unit_type,
   carpet_area,built_up_area,saleable_area,base_rate,parking_charges,
   other_charges,gst_rate,status)
 SELECT v_project,f.building_id,f.id,btrim(_number),_type,
   _carpet,_built_up,_saleable,_rate,coalesce(_parking,0),
   coalesce(_other,0),coalesce(_gst,5),'available'::public.unit_status
 FROM public.floors f WHERE f.id=_floor_id
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.sales_book_flat(
 _unit_id uuid,_name text,_mobile text,_price numeric,
 _booked_on date DEFAULT current_date,_email text DEFAULT NULL,
 _co_buyer text DEFAULT NULL,_notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_unit public.units%ROWTYPE;v_company uuid;v_id uuid;
BEGIN
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied';END IF;
 SELECT * INTO v_unit FROM public.units WHERE id=_unit_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(v_unit.project_id) THEN
   RAISE EXCEPTION 'Flat not accessible';END IF;
 IF v_unit.status<>'available' OR v_unit.record_status<>'active' THEN
   RAISE EXCEPTION 'This flat is not available';END IF;
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
END $$;

-- Reported amounts are pending verification and NEVER reduce customer dues.
CREATE OR REPLACE FUNCTION public.sales_report_receipt(
 _sale_id uuid,_amount numeric,_paid_on date,_method text,
 _reference text DEFAULT NULL,_payer text DEFAULT NULL,_notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_sale public.property_sales%ROWTYPE;v_id uuid;
BEGIN
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied';END IF;
 SELECT * INTO v_sale FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(v_sale.project_id) THEN
   RAISE EXCEPTION 'Sale not accessible';END IF;
 IF v_sale.status='cancelled' THEN RAISE EXCEPTION 'Cancelled booking';END IF;
 IF _amount IS NULL OR _amount<=0 OR _amount>v_sale.final_sale_price THEN
   RAISE EXCEPTION 'Invalid receipt amount';END IF;
 IF _paid_on IS NULL OR _paid_on>current_date THEN
   RAISE EXCEPTION 'Receipt date cannot be in the future';END IF;
 IF _method NOT IN ('cash','upi','neft','rtgs','imps','cheque','card','other') THEN
   RAISE EXCEPTION 'Invalid payment method';END IF;
 IF _method<>'cash' AND length(btrim(coalesce(_reference,'')))<3 THEN
   RAISE EXCEPTION 'Payment reference is required for non-cash payments';END IF;
 INSERT INTO public.property_sale_receipts(sale_id,amount,paid_on,method,
  reference,payer_name,notes,created_by)
 VALUES(_sale_id,round(_amount,2),_paid_on,_method,
  nullif(btrim(coalesce(_reference,'')),''),
  nullif(btrim(coalesce(_payer,'')),''),
  nullif(btrim(coalesce(_notes,'')),''),auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'receipt_reported',jsonb_build_object('receipt_id',v_id,
        'amount',round(_amount,2)),auth.uid());
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.sales_review_receipt(
 _receipt_id uuid,_approve boolean,_note text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_receipt public.property_sale_receipts%ROWTYPE;
  v_sale public.property_sales%ROWTYPE;v_paid numeric;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only';END IF;
 SELECT sale_id INTO v_receipt.sale_id FROM public.property_sale_receipts
 WHERE id=_receipt_id;
 IF v_receipt.sale_id IS NULL THEN RAISE EXCEPTION 'Receipt not found';END IF;
 SELECT * INTO v_sale FROM public.property_sales
 WHERE id=v_receipt.sale_id FOR UPDATE;
 IF NOT public.sales_project_allowed(v_sale.project_id) THEN
   RAISE EXCEPTION 'Sale not accessible';END IF;
 SELECT * INTO v_receipt FROM public.property_sale_receipts
 WHERE id=_receipt_id FOR UPDATE;
 IF v_receipt.status<>'reported' THEN RAISE EXCEPTION 'Receipt already reviewed';END IF;
 IF v_sale.status='cancelled' THEN RAISE EXCEPTION 'Cancelled booking';END IF;
 IF NOT _approve AND length(btrim(coalesce(_note,'')))<3 THEN
   RAISE EXCEPTION 'Reason for rejecting receipt is required';END IF;
 IF _approve THEN
   SELECT coalesce(sum(amount),0) INTO v_paid FROM public.property_sale_receipts
   WHERE sale_id=v_sale.id AND status='verified';
   IF v_paid+v_receipt.amount>v_sale.final_sale_price+0.005 THEN
     RAISE EXCEPTION 'Verified receipts exceed the agreed sale price';END IF;
 END IF;
 UPDATE public.property_sale_receipts
 SET status=CASE WHEN _approve THEN 'verified' ELSE 'rejected' END,
     reviewer_note=nullif(btrim(coalesce(_note,'')),''),
     reviewed_by=auth.uid(),reviewed_at=now()
 WHERE id=_receipt_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(v_sale.id,CASE WHEN _approve THEN 'receipt_verified' ELSE 'receipt_rejected' END,
 jsonb_build_object('receipt_id',_receipt_id,'amount',v_receipt.amount,
                    'note',_note),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.sales_set_stage(
 _sale_id uuid,_status text,_reason text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_sale public.property_sales%ROWTYPE;v_next text;v_receipts integer;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only';END IF;
 SELECT * INTO v_sale FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(v_sale.project_id) THEN
   RAISE EXCEPTION 'Sale not accessible';END IF;
 IF v_sale.status='cancelled' OR v_sale.status='possession_completed' THEN
   RAISE EXCEPTION 'Finalized sale cannot change stage';END IF;
 v_next=CASE v_sale.status
  WHEN 'booked' THEN 'agreement_pending'
  WHEN 'agreement_pending' THEN 'agreement_done'
  WHEN 'agreement_done' THEN 'registered'
  WHEN 'registered' THEN 'possession_pending'
  WHEN 'possession_pending' THEN 'possession_completed'
  ELSE NULL END;
 IF _status NOT IN (v_next,'cancelled') THEN
   RAISE EXCEPTION 'Invalid sale stage transition';END IF;
 IF _status='cancelled' THEN
   IF length(btrim(coalesce(_reason,'')))<5 THEN
     RAISE EXCEPTION 'Cancellation reason is required';END IF;
   SELECT count(*) INTO v_receipts FROM public.property_sale_receipts
   WHERE sale_id=_sale_id AND status IN ('reported','verified');
   IF v_receipts>0 THEN
     RAISE EXCEPTION 'Resolve all reported/verified receipts before cancelling';END IF;
 ELSE
   IF _status='possession_completed' AND EXISTS(
       SELECT 1 FROM public.property_sale_receipts r WHERE r.sale_id=_sale_id
         AND r.status='reported') THEN
     RAISE EXCEPTION 'Pending receipt verification must be resolved';END IF;
   IF _status='possession_completed' AND
      (SELECT coalesce(sum(amount),0) FROM public.property_sale_receipts
       WHERE sale_id=_sale_id AND status='verified')<v_sale.final_sale_price THEN
     RAISE EXCEPTION 'Full payment verification required before possession completed';END IF;
 END IF;
 UPDATE public.property_sales SET status=_status,updated_at=now()
 WHERE id=_sale_id;
 PERFORM set_config('app.unit_status_source','sales',true);
 PERFORM set_config('app.unit_status_reason',
    coalesce(nullif(btrim(coalesce(_reason,'')),''),'Sale stage update'),true);
 UPDATE public.units SET
 status=CASE WHEN _status='cancelled' THEN 'available'::public.unit_status
             ELSE _status::public.unit_status END
 WHERE id=v_sale.unit_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,CASE WHEN _status='cancelled' THEN 'cancelled' ELSE 'stage_advanced' END,
 jsonb_build_object('from',v_sale.status,'to',_status,'reason',_reason),auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.sales_allowed(),
 public.sales_manager(),public.sales_project_allowed(uuid),
 public.sales_add_flat(uuid,text,public.unit_type,numeric,numeric,numeric,numeric,numeric,numeric,numeric),
 public.sales_book_flat(uuid,text,text,numeric,date,text,text,text),
 public.sales_report_receipt(uuid,numeric,date,text,text,text,text),
 public.sales_review_receipt(uuid,boolean,text),
 public.sales_set_stage(uuid,text,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_allowed(),
 public.sales_manager(),public.sales_project_allowed(uuid),
 public.sales_add_flat(uuid,text,public.unit_type,numeric,numeric,numeric,numeric,numeric,numeric,numeric),
 public.sales_book_flat(uuid,text,text,numeric,date,text,text,text),
 public.sales_report_receipt(uuid,numeric,date,text,text,text,text),
 public.sales_review_receipt(uuid,boolean,text),
 public.sales_set_stage(uuid,text,text)
 TO authenticated;
