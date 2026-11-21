-- 0093 Sales cancellation lifecycle.
-- All sale/receipt histories remain immutable. Customer refunds are a
-- separate, auditable payment-out ledger; no automatic money movement.

CREATE TABLE public.property_sale_cancel_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.property_sales(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason))>=10),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  reviewer_note text,
  CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
      OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX property_sale_one_pending_cancel_request
  ON public.property_sale_cancel_requests(sale_id) WHERE status='pending';
CREATE INDEX property_sale_cancel_request_sale_idx
  ON public.property_sale_cancel_requests(sale_id, requested_at DESC);

CREATE TABLE public.property_sale_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL UNIQUE REFERENCES public.property_sales(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason))>=10),
  verified_received numeric(16,2) NOT NULL CHECK(verified_received>=0),
  cancellation_fee numeric(16,2) NOT NULL CHECK(cancellation_fee>=0),
  refund_due numeric(16,2) NOT NULL CHECK(refund_due>=0),
  cancelled_by uuid NOT NULL REFERENCES public.profiles(id),
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cancellation_fee<=verified_received),
  CHECK (abs(refund_due-(verified_received-cancellation_fee))<0.01)
);
CREATE TABLE public.property_sale_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cancellation_id uuid NOT NULL REFERENCES public.property_sale_cancellations(id) ON DELETE RESTRICT,
  amount numeric(16,2) NOT NULL CHECK(amount>0),
  refunded_on date NOT NULL CHECK(refunded_on<=current_date),
  method text NOT NULL CHECK(method IN ('cash','upi','neft','rtgs','imps','cheque','other')),
  reference text,
  notes text,
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX property_sale_refunds_reference_idx
  ON public.property_sale_refunds(cancellation_id,method,lower(reference))
  WHERE reference IS NOT NULL;
CREATE INDEX property_sale_refunds_cancel_idx ON public.property_sale_refunds(cancellation_id);

ALTER TABLE public.property_sale_cancel_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_sale_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_sale_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_sale_cancel_requests,public.property_sale_cancellations,
  public.property_sale_refunds FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.property_sale_cancel_requests,public.property_sale_cancellations,
  public.property_sale_refunds TO authenticated;

CREATE POLICY "Accessible cancellation requests" ON public.property_sale_cancel_requests
 FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.property_sales s WHERE s.id=sale_id AND public.sales_project_allowed(s.project_id)));
CREATE POLICY "Accessible booking cancellations" ON public.property_sale_cancellations
 FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.property_sales s WHERE s.id=sale_id AND public.sales_project_allowed(s.project_id)));
CREATE POLICY "Accessible booking refunds" ON public.property_sale_refunds
 FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.property_sale_cancellations c
 JOIN public.property_sales s ON s.id=c.sale_id
 WHERE c.id=cancellation_id AND public.sales_project_allowed(s.project_id)));

CREATE OR REPLACE FUNCTION public.sales_request_cancellation(_sale_id uuid,_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE; request_id uuid;
BEGIN
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id) THEN RAISE EXCEPTION 'Booking not accessible'; END IF;
 IF s.status NOT IN ('booked','agreement_pending') THEN
   RAISE EXCEPTION 'This stage requires legal review; booking cancellation is not available'; END IF;
 IF length(btrim(coalesce(_reason,'')))<10 THEN RAISE EXCEPTION 'Explain cancellation in at least 10 characters'; END IF;
 IF EXISTS(SELECT 1 FROM public.property_sale_cancel_requests r WHERE r.sale_id=_sale_id AND r.status='pending') THEN
   RAISE EXCEPTION 'A cancellation request is already pending'; END IF;
 INSERT INTO public.property_sale_cancel_requests(sale_id,reason,requested_by)
 VALUES(_sale_id,btrim(_reason),auth.uid()) RETURNING id INTO request_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'cancellation_requested',jsonb_build_object('request_id',request_id,'reason',btrim(_reason)),auth.uid());
 RETURN request_id;
END $$;

CREATE OR REPLACE FUNCTION public.sales_decline_cancellation(_request_id uuid,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.property_sale_cancel_requests%ROWTYPE; s public.property_sales%ROWTYPE;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT * INTO r FROM public.property_sale_cancel_requests WHERE id=_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cancellation request not found'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=r.sale_id FOR UPDATE;
 IF NOT public.sales_project_allowed(s.project_id) OR r.status<>'pending' THEN
   RAISE EXCEPTION 'Cancellation request is not pending or accessible'; END IF;
 IF length(btrim(coalesce(_reason,'')))<5 THEN RAISE EXCEPTION 'Enter a review reason'; END IF;
 UPDATE public.property_sale_cancel_requests SET status='declined',reviewed_by=auth.uid(),
  reviewed_at=now(),reviewer_note=btrim(_reason) WHERE id=_request_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(r.sale_id,'cancellation_declined',jsonb_build_object('request_id',r.id,'reason',btrim(_reason)),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.sales_cancel_booking(_sale_id uuid,_reason text,_fee numeric DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE; c_id uuid; paid numeric; fee numeric; r public.property_sale_cancel_requests%ROWTYPE;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id) OR NOT public.actor_in_company(s.company_id) THEN
   RAISE EXCEPTION 'Booking not accessible'; END IF;
 IF s.status NOT IN ('booked','agreement_pending') THEN
   RAISE EXCEPTION 'Only bookings before an executed agreement may be cancelled here. Seek a legal reversal for later stages'; END IF;
 IF length(btrim(coalesce(_reason,'')))<10 THEN RAISE EXCEPTION 'Explain cancellation in at least 10 characters'; END IF;
 IF EXISTS(SELECT 1 FROM public.property_sale_receipts
   WHERE sale_id=_sale_id AND status='reported') THEN
   RAISE EXCEPTION 'Review pending payment receipts before cancellation'; END IF;
 SELECT coalesce(sum(amount),0) INTO paid FROM public.property_sale_receipts
 WHERE sale_id=_sale_id AND status='verified';
 fee:=round(coalesce(_fee,0),2);
 IF fee<0 OR fee>paid THEN RAISE EXCEPTION 'Cancellation charge cannot exceed verified customer collections'; END IF;
 -- Lock the flat and recheck its state. Entire operation is atomic.
 PERFORM 1 FROM public.units u WHERE u.id=s.unit_id AND u.status=s.status::public.unit_status FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Flat status and booking do not match; do not release automatically'; END IF;
 INSERT INTO public.property_sale_cancellations(sale_id,reason,verified_received,cancellation_fee,refund_due,cancelled_by)
 VALUES(_sale_id,btrim(_reason),paid,fee,paid-fee,auth.uid()) RETURNING id INTO c_id;
 UPDATE public.property_sales SET status='cancelled',updated_at=now() WHERE id=_sale_id;
 PERFORM set_config('app.unit_status_source','sales',true);
 PERFORM set_config('app.unit_status_reason','Booking cancelled (financial record retained)',true);
 UPDATE public.units SET status='available'::public.unit_status WHERE id=s.unit_id;
 FOR r IN SELECT * FROM public.property_sale_cancel_requests WHERE sale_id=_sale_id AND status='pending' FOR UPDATE LOOP
  UPDATE public.property_sale_cancel_requests SET status='approved',reviewed_by=auth.uid(),
    reviewed_at=now(),reviewer_note='Booking cancellation approved'
    WHERE id=r.id;
 END LOOP;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'cancelled',jsonb_build_object('from',s.status,'reason',btrim(_reason),
 'verified_received',paid,'cancellation_fee',fee,'refund_due',paid-fee,'cancellation_id',c_id),auth.uid());
 RETURN c_id;
END $$;

CREATE OR REPLACE FUNCTION public.sales_record_refund(
 _sale_id uuid,_amount numeric,_refunded_on date,_method text,
 _reference text DEFAULT NULL,_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE; c public.property_sale_cancellations%ROWTYPE;
  issued numeric; amount numeric; refund_id uuid;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id) OR NOT public.actor_in_company(s.company_id) THEN
   RAISE EXCEPTION 'Sale not accessible'; END IF;
 SELECT * INTO c FROM public.property_sale_cancellations WHERE sale_id=_sale_id FOR UPDATE;
 IF NOT FOUND OR s.status<>'cancelled' THEN RAISE EXCEPTION 'No cancelled booking with refund due'; END IF;
 amount:=round(coalesce(_amount,0),2);
 IF amount<=0 OR _refunded_on IS NULL OR _refunded_on>current_date OR _refunded_on<c.cancelled_at::date THEN
  RAISE EXCEPTION 'Enter a positive refund and a valid refund date'; END IF;
 IF _method NOT IN ('cash','upi','neft','rtgs','imps','cheque','other') THEN
  RAISE EXCEPTION 'Invalid refund method'; END IF;
 IF _method<>'cash' AND length(btrim(coalesce(_reference,'')))<3 THEN
  RAISE EXCEPTION 'Transaction reference is required for non-cash refunds'; END IF;
 SELECT coalesce(sum(amount),0) INTO issued FROM public.property_sale_refunds WHERE cancellation_id=c.id;
 IF issued+amount>c.refund_due THEN RAISE EXCEPTION 'Refund would exceed the outstanding refund liability'; END IF;
 INSERT INTO public.property_sale_refunds(cancellation_id,amount,refunded_on,method,reference,notes,recorded_by)
 VALUES(c.id,amount,_refunded_on,_method,nullif(btrim(coalesce(_reference,'')),''),
 nullif(btrim(coalesce(_notes,'')),''),auth.uid()) RETURNING id INTO refund_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'refund_recorded',jsonb_build_object('refund_id',refund_id,'amount',amount,
 'outstanding_after',c.refund_due-issued-amount),auth.uid());
 RETURN refund_id;
END $$;

-- Old generic stage action must not remain an alternate route that cancels a
-- sale without writing its mandatory cancellation and refund accounting.
CREATE OR REPLACE FUNCTION public.sales_set_stage(_sale_id uuid,_status text,_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE; next_stage text; paid numeric;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id) THEN RAISE EXCEPTION 'Sale not accessible'; END IF;
 IF s.status IN ('cancelled','possession_completed') THEN RAISE EXCEPTION 'Finalized sale cannot change stage'; END IF;
 next_stage:=CASE s.status
  WHEN 'booked' THEN 'agreement_pending' WHEN 'agreement_pending' THEN 'agreement_done'
  WHEN 'agreement_done' THEN 'registered' WHEN 'registered' THEN 'possession_pending'
  WHEN 'possession_pending' THEN 'possession_completed' ELSE NULL END;
 IF _status IS DISTINCT FROM next_stage THEN RAISE EXCEPTION 'Invalid stage. Use the controlled cancellation workflow to cancel'; END IF;
 IF _status='possession_completed' THEN
  IF EXISTS(SELECT 1 FROM public.property_sale_receipts WHERE sale_id=_sale_id AND status='reported') THEN
    RAISE EXCEPTION 'Pending receipt verification must be resolved'; END IF;
  SELECT coalesce(sum(amount),0) INTO paid FROM public.property_sale_receipts
    WHERE sale_id=_sale_id AND status='verified';
  IF paid<s.final_sale_price THEN RAISE EXCEPTION 'Full payment verification required before possession'; END IF;
 END IF;
 UPDATE public.property_sales SET status=_status,updated_at=now() WHERE id=_sale_id;
 PERFORM set_config('app.unit_status_source','sales',true);
 PERFORM set_config('app.unit_status_reason','Sale stage update',true);
 UPDATE public.units SET status=_status::public.unit_status WHERE id=s.unit_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'stage_advanced',jsonb_build_object('from',s.status,'to',_status,'reason',_reason),auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.sales_request_cancellation(uuid,text),
 public.sales_decline_cancellation(uuid,text),
 public.sales_cancel_booking(uuid,text,numeric),
 public.sales_record_refund(uuid,numeric,date,text,text,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_request_cancellation(uuid,text),
 public.sales_decline_cancellation(uuid,text),
 public.sales_cancel_booking(uuid,text,numeric),
 public.sales_record_refund(uuid,numeric,date,text,text,text)
 TO authenticated;
