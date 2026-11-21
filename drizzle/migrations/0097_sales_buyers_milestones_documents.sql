-- 0097: customer detail, instalment schedules, legal milestones and private files.
-- Original booking buyer snapshots and actual payment receipts remain unchanged.
CREATE TABLE public.property_sale_buyer_details (
 sale_id uuid PRIMARY KEY REFERENCES public.property_sales(id) ON DELETE RESTRICT,
 address text,city text,state text,pincode text,alternate_mobile text,
 identification_type text CHECK (identification_type IS NULL OR identification_type IN ('pan','aadhaar','passport','driving_license','other')),
 identification_last4 text CHECK (identification_last4 IS NULL OR identification_last4 ~ '^[A-Za-z0-9]{4}$'),
 notes text,
 updated_by uuid NOT NULL REFERENCES public.profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.property_sale_legal_details (
 sale_id uuid PRIMARY KEY REFERENCES public.property_sales(id) ON DELETE RESTRICT,
 agreement_number text,agreement_date date,registration_number text,registration_date date,
 registration_office text,notes text,
 updated_by uuid NOT NULL REFERENCES public.profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (registration_date IS NULL OR agreement_date IS NOT NULL),
 CHECK (registration_date IS NULL OR registration_date>=agreement_date)
);
CREATE TABLE public.property_sale_payment_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_id uuid NOT NULL REFERENCES public.property_sales(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 reason text NOT NULL CHECK(length(btrim(reason))>=5),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sale_id,version)
);
CREATE INDEX property_sale_payment_plans_sale_idx ON public.property_sale_payment_plans(sale_id,version DESC);
CREATE TABLE public.property_sale_payment_milestones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES public.property_sale_payment_plans(id) ON DELETE RESTRICT,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 30),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 2 AND 100),
 due_on date NOT NULL,
 expected_amount numeric(16,2) NOT NULL CHECK(expected_amount>0),
 UNIQUE(plan_id,sequence)
);
CREATE TABLE public.property_sale_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_id uuid NOT NULL REFERENCES public.property_sales(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('buyer_id','booking_form','agreement','registration','payment_proof','other')),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 150),
 storage_path text NOT NULL UNIQUE,
 uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
 uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX property_sale_documents_sale_idx ON public.property_sale_documents(sale_id,uploaded_at DESC);

ALTER TABLE public.property_sale_buyer_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_sale_legal_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_sale_payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_sale_payment_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_sale_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_sale_buyer_details,public.property_sale_legal_details,
 public.property_sale_payment_plans,public.property_sale_payment_milestones,
 public.property_sale_documents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.property_sale_buyer_details,public.property_sale_legal_details,
 public.property_sale_payment_plans,public.property_sale_payment_milestones,
 public.property_sale_documents TO authenticated;
CREATE POLICY "Assigned sales buyer details" ON public.property_sale_buyer_details
 FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.property_sales s WHERE s.id=sale_id AND public.sales_project_allowed(s.project_id)));
CREATE POLICY "Assigned sales legal details" ON public.property_sale_legal_details
 FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.property_sales s WHERE s.id=sale_id AND public.sales_project_allowed(s.project_id)));
CREATE POLICY "Assigned sales plans" ON public.property_sale_payment_plans
 FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.property_sales s WHERE s.id=sale_id AND public.sales_project_allowed(s.project_id)));
CREATE POLICY "Assigned sales milestones" ON public.property_sale_payment_milestones
 FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.property_sale_payment_plans p JOIN public.property_sales s ON s.id=p.sale_id
 WHERE p.id=plan_id AND public.sales_project_allowed(s.project_id)));
CREATE POLICY "Assigned sales documents" ON public.property_sale_documents
 FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.property_sales s WHERE s.id=sale_id AND public.sales_project_allowed(s.project_id)));

CREATE OR REPLACE FUNCTION public.sales_save_buyer_details(
 _sale_id uuid,_address text,_city text,_state text,_pincode text,_alternate text,
 _id_type text,_last4 text,_notes text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE;
BEGIN
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id)
    OR NOT public.actor_in_company(s.company_id) THEN RAISE EXCEPTION 'Booking not accessible'; END IF;
 IF _id_type IS NOT NULL AND _id_type NOT IN ('pan','aadhaar','passport','driving_license','other') THEN
   RAISE EXCEPTION 'Invalid identification type'; END IF;
 IF _last4 IS NOT NULL AND _last4 !~ '^[A-Za-z0-9]{4}$' THEN
   RAISE EXCEPTION 'Only the final four ID characters may be stored'; END IF;
 IF length(coalesce(_address,''))>500 OR length(coalesce(_notes,''))>2000 OR
    length(coalesce(_city,''))>120 OR length(coalesce(_state,''))>120 OR
    length(coalesce(_pincode,''))>15 OR length(coalesce(_alternate,''))>20 THEN
    RAISE EXCEPTION 'Buyer details exceed field limits'; END IF;
 INSERT INTO public.property_sale_buyer_details(sale_id,address,city,state,pincode,
  alternate_mobile,identification_type,identification_last4,notes,updated_by)
 VALUES(_sale_id,nullif(btrim(coalesce(_address,'')),''),
  nullif(btrim(coalesce(_city,'')),''),
  nullif(btrim(coalesce(_state,'')),''),
  nullif(btrim(coalesce(_pincode,'')),''),
  nullif(btrim(coalesce(_alternate,'')),''),
  _id_type,_last4,nullif(btrim(coalesce(_notes,'')),''),auth.uid())
 ON CONFLICT(sale_id) DO UPDATE SET address=excluded.address,city=excluded.city,
  state=excluded.state,pincode=excluded.pincode,alternate_mobile=excluded.alternate_mobile,
  identification_type=excluded.identification_type,identification_last4=excluded.identification_last4,
  notes=excluded.notes,updated_by=auth.uid(),updated_at=now();
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'buyer_details_updated',jsonb_build_object('id_type',_id_type,'has_address',length(coalesce(_address,''))>0),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.sales_save_legal_details(
 _sale_id uuid,_agreement_number text,_agreement_date date,_registration_number text,
 _registration_date date,_registration_office text,_notes text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id)
    OR NOT public.actor_in_company(s.company_id) OR s.status='cancelled' THEN
    RAISE EXCEPTION 'Booking not accessible or cancelled'; END IF;
 IF _agreement_date>current_date OR _registration_date>current_date OR
    (_registration_date IS NOT NULL AND
       (_agreement_date IS NULL OR _registration_date<_agreement_date)) THEN
    RAISE EXCEPTION 'Check agreement and registration dates'; END IF;
 IF (_agreement_date IS NOT NULL AND length(btrim(coalesce(_agreement_number,'')))<3)
 OR (_registration_date IS NOT NULL AND length(btrim(coalesce(_registration_number,'')))<3) THEN
    RAISE EXCEPTION 'Enter agreement or registration reference with its date'; END IF;
 IF length(coalesce(_agreement_number,''))>120 OR length(coalesce(_registration_number,''))>120
 OR length(coalesce(_registration_office,''))>200 OR length(coalesce(_notes,''))>1000 THEN
    RAISE EXCEPTION 'Legal reference is too long'; END IF;
 INSERT INTO public.property_sale_legal_details(sale_id,agreement_number,agreement_date,
   registration_number,registration_date,registration_office,notes,updated_by)
 VALUES(_sale_id,nullif(btrim(coalesce(_agreement_number,'')),''),
 _agreement_date,nullif(btrim(coalesce(_registration_number,'')),''),_registration_date,
 nullif(btrim(coalesce(_registration_office,'')),''),nullif(btrim(coalesce(_notes,'')),''),auth.uid())
 ON CONFLICT(sale_id) DO UPDATE SET agreement_number=excluded.agreement_number,
 agreement_date=excluded.agreement_date,registration_number=excluded.registration_number,
 registration_date=excluded.registration_date,registration_office=excluded.registration_office,
 notes=excluded.notes,updated_by=auth.uid(),updated_at=now();
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'legal_details_updated',jsonb_build_object(
 'agreement_number',_agreement_number,'agreement_date',_agreement_date,
 'registration_number',_registration_number,'registration_date',_registration_date),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.sales_set_payment_plan(
 _sale_id uuid,_rows jsonb,_reason text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE;plan_id uuid;v integer; r jsonb;
 seq integer:=0; total numeric:=0;amount numeric;due date;label text;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id)
 OR NOT public.actor_in_company(s.company_id) OR s.status='cancelled' THEN
   RAISE EXCEPTION 'Active booking required'; END IF;
 IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows) NOT BETWEEN 1 AND 30 THEN
   RAISE EXCEPTION 'Enter 1–30 instalments'; END IF;
 IF length(btrim(coalesce(_reason,'')))<5 THEN RAISE EXCEPTION 'Enter a payment schedule reason'; END IF;
 SELECT coalesce(max(version),0)+1 INTO v FROM public.property_sale_payment_plans WHERE sale_id=_sale_id;
 INSERT INTO public.property_sale_payment_plans(sale_id,version,reason,created_by)
 VALUES(_sale_id,v,btrim(_reason),auth.uid()) RETURNING id INTO plan_id;
 FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
  seq:=seq+1;
  label:=btrim(coalesce(r->>'label',''));
  IF length(label) NOT BETWEEN 2 AND 100 OR coalesce(r->>'amount','') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$'
  OR coalesce(r->>'due_on','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Invalid instalment at row %',seq; END IF;
  amount:=(r->>'amount')::numeric;due:=(r->>'due_on')::date;
  IF amount<=0 OR due<s.booked_on THEN RAISE EXCEPTION 'Invalid amount/date on instalment %',seq; END IF;
  INSERT INTO public.property_sale_payment_milestones(plan_id,sequence,label,due_on,expected_amount)
  VALUES(plan_id,seq,label,due,amount);
  total:=total+amount;
 END LOOP;
 IF abs(total-s.final_sale_price)>0.005 THEN
   RAISE EXCEPTION 'Instalments must total exactly the agreed sale price: %',s.final_sale_price;
 END IF;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'payment_plan_saved',jsonb_build_object('version',v,'total',total,'instalments',seq),auth.uid());
 RETURN v;
END $$;

-- Verified receipts are allocated only for display, in milestone order.
-- This is an indicative running balance, not a receipt-to-milestone allocation ledger.
CREATE OR REPLACE FUNCTION public.sales_current_milestones(_sale_id uuid)
RETURNS TABLE(sequence integer,label text,due_on date,expected numeric,credited numeric,outstanding numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH allowed AS (
   SELECT s.id FROM public.property_sales s WHERE s.id=_sale_id
     AND public.sales_project_allowed(s.project_id)
 ), latest AS (
   SELECT p.id FROM public.property_sale_payment_plans p
     JOIN allowed s ON s.id=p.sale_id ORDER BY p.version DESC LIMIT 1
 ), paid AS (
   SELECT coalesce(sum(r.amount),0) AS total
   FROM public.property_sale_receipts r JOIN allowed s ON s.id=r.sale_id WHERE r.status='verified'
 ), instalments AS (
   SELECT m.sequence,m.label,m.due_on,m.expected_amount,
     coalesce(sum(m.expected_amount) OVER(ORDER BY m.sequence
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS earlier
   FROM public.property_sale_payment_milestones m JOIN latest p ON p.id=m.plan_id
 )
 SELECT i.sequence,i.label,i.due_on,i.expected_amount,
  least(i.expected_amount,greatest(0,paid.total-i.earlier)),
  greatest(0,i.expected_amount-least(i.expected_amount,greatest(0,paid.total-i.earlier)))
 FROM instalments i CROSS JOIN paid ORDER BY i.sequence;
$$;

-- Private buyer/legal attachments. Path: company/sale/uploader/random.pdf
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('sales-documents','sales-documents',false,10485760,
 ARRAY['application/pdf','image/jpeg','image/png']::text[])
ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sales_doc_access(_path text,_upload boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND public.is_active_user(auth.uid())
 AND split_part(_path,'/',4) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$'
 AND EXISTS(
  SELECT 1 FROM public.property_sales s
  WHERE s.company_id::text=split_part(_path,'/',1)
    AND s.id::text=split_part(_path,'/',2)
    AND public.actor_in_company(s.company_id)
    AND public.sales_project_allowed(s.project_id)
    AND (
      (_upload AND split_part(_path,'/',3)=auth.uid()::text)
      OR (NOT _upload AND (
        split_part(_path,'/',3)=auth.uid()::text OR EXISTS(
          SELECT 1 FROM public.property_sale_documents doc
          WHERE doc.sale_id=s.id AND doc.storage_path=_path
        )
      ))
    )
 );
$$;
REVOKE ALL ON FUNCTION public.sales_doc_access(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_doc_access(text,boolean) TO authenticated;
CREATE POLICY "Sales private file upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='sales-documents' AND public.sales_doc_access(name,true));
CREATE POLICY "Sales private file read" ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='sales-documents' AND public.sales_doc_access(name,false));

CREATE OR REPLACE FUNCTION public.sales_link_document(
 _sale_id uuid,_kind text,_path text,_filename text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE s public.property_sales%ROWTYPE;doc_id uuid;
BEGIN
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied'; END IF;
 SELECT * INTO s FROM public.property_sales WHERE id=_sale_id;
 IF NOT FOUND OR NOT public.sales_project_allowed(s.project_id)
  OR NOT public.actor_in_company(s.company_id) THEN RAISE EXCEPTION 'Sale not accessible'; END IF;
 IF _kind NOT IN ('buyer_id','booking_form','agreement','registration','payment_proof','other')
   OR length(btrim(coalesce(_filename,''))) NOT BETWEEN 1 AND 150
   OR _path IS NULL OR NOT public.sales_doc_access(_path,true) THEN
   RAISE EXCEPTION 'Invalid document type, name or storage path'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='sales-documents'
   AND o.name=_path) THEN RAISE EXCEPTION 'Upload the private file before linking it'; END IF;
 INSERT INTO public.property_sale_documents(sale_id,kind,filename,storage_path,uploaded_by)
 VALUES(_sale_id,_kind,btrim(_filename),_path,auth.uid()) RETURNING id INTO doc_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'document_added',jsonb_build_object('kind',_kind,'document_id',doc_id),auth.uid());
 RETURN doc_id;
END $$;
REVOKE ALL ON FUNCTION public.sales_save_buyer_details(uuid,text,text,text,text,text,text,text,text),
 public.sales_save_legal_details(uuid,text,date,text,date,text,text),
 public.sales_set_payment_plan(uuid,jsonb,text),
 public.sales_current_milestones(uuid),
 public.sales_link_document(uuid,text,text,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_save_buyer_details(uuid,text,text,text,text,text,text,text,text),
 public.sales_save_legal_details(uuid,text,date,text,date,text,text),
 public.sales_set_payment_plan(uuid,jsonb,text),
 public.sales_current_milestones(uuid),
 public.sales_link_document(uuid,text,text,text)
 TO authenticated;
