-- New vendor challans require photographic evidence in private storage.
-- This additive column is nullable solely to preserve historical records;
-- authenticated registration is enforced by register_vendor_delivery_challan.
ALTER TABLE public.vendor_delivery_challans
  ADD COLUMN IF NOT EXISTS photo_path text;

-- Reuse private procurement-attachments bucket, which already limits file size
-- to 10 MB. Authorize GRN creators to upload PHOTO objects only to their own
-- company/account folder; existing PR/quotation policies remain untouched.
DROP POLICY IF EXISTS "Delivery challan photo upload" ON storage.objects;
CREATE POLICY "Delivery challan photo upload"
ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='procurement-attachments'
  AND (storage.foldername(name))[1] = (
    SELECT p.company_id::text FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active
  )
  AND (storage.foldername(name))[2] = auth.uid()::text
  AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png)$'
  AND public.has_permission(auth.uid(),'grn.create')
);

CREATE OR REPLACE FUNCTION public.can_read_delivery_challan_photo(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT _path IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.vendor_delivery_challans dc
    WHERE dc.photo_path=_path
      AND public.actor_in_company(dc.company_id)
      AND public.can_access_project(auth.uid(),dc.project_id)
      AND (
        public.has_permission(auth.uid(),'grn.view')
        OR public.has_permission(auth.uid(),'purchase_order.view')
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_delivery_challan_photo(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_delivery_challan_photo(text) TO authenticated;

-- A separate SELECT policy makes the linked photo visible to authorized
-- project staff without exposing other suppliers' or companies' files.
DROP POLICY IF EXISTS "Delivery challan photo read" ON storage.objects;
CREATE POLICY "Delivery challan photo read"
ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='procurement-attachments'
  AND public.can_read_delivery_challan_photo(name)
);

-- Registration RPC preserved from migration 0014 with one new mandatory
-- photo check and an immutable linkage. Existing PO, item, audit and
-- inventory validations are deliberately retained unchanged.

CREATE OR REPLACE FUNCTION public.register_vendor_delivery_challan(_po_id uuid, _header jsonb, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record; dc_id uuid; dc_number text; dc_date date; line jsonb; poi record; qty numeric; n integer := 0; photo_path text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'grn.create') THEN
    RAISE EXCEPTION 'No permission to register delivery challans';
  END IF;
  SELECT * INTO p FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT public.can_access_project(auth.uid(), p.project_id) THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles v WHERE v.id=auth.uid() AND v.is_active AND v.company_id=p.company_id) THEN
    RAISE EXCEPTION 'Not authorised for this company';
  END IF;
  IF p.status NOT IN ('approved','sent','partially_received','partially_accepted') THEN
    RAISE EXCEPTION 'Only open approved purchase orders can receive supplier challans';
  END IF;
  dc_number := btrim(coalesce(_header->>'challan_number',''));
  IF length(dc_number) < 1 OR length(dc_number) > 100 THEN
    RAISE EXCEPTION 'Enter the vendor delivery challan number (max 100 characters)';
  END IF;
  dc_date := nullif(_header->>'challan_date','')::date;
  IF dc_date IS NULL OR dc_date > public.ist_today() THEN
    RAISE EXCEPTION 'Enter a valid challan date, not in the future';
  END IF;
  photo_path := nullif(btrim(_header->>'photo_path'), '');
  IF photo_path IS NULL THEN
    RAISE EXCEPTION 'A challan photo is compulsory. Upload a JPG or PNG image before registering.';
  END IF;
  IF NOT public.procurement_attachment_owned(photo_path,p.company_id,auth.uid())
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
       WHERE o.bucket_id='procurement-attachments' AND o.name=photo_path
         AND o.metadata->>'mimetype' IN ('image/jpeg','image/png')
     ) THEN
    RAISE EXCEPTION 'Challan photo must be a private JPG or PNG uploaded by your account';
  END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Challan lines must be an array';
  END IF;
  INSERT INTO public.vendor_delivery_challans (
    company_id,po_id,vendor_id,project_id,building_id,challan_number,challan_date,
    vehicle_number,invoice_reference,remarks,created_by,photo_path
  ) VALUES (
    p.company_id,p.id,p.vendor_id,p.project_id,p.building_id,dc_number,dc_date,
    nullif(btrim(_header->>'vehicle_number'),''),
    nullif(btrim(_header->>'invoice_reference'),''),
    nullif(btrim(_header->>'remarks'),''),
    auth.uid(),photo_path
  ) RETURNING id INTO dc_id;
  FOR line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    qty := nullif(line->>'quantity','')::numeric;
    IF qty IS NULL OR qty <= 0 THEN RAISE EXCEPTION 'Each challan line needs a positive quantity'; END IF;
    SELECT * INTO poi FROM public.purchase_order_items
      WHERE id=(line->>'po_item_id')::uuid AND po_id=_po_id;
    IF poi IS NULL THEN RAISE EXCEPTION 'A challan line is not on this purchase order'; END IF;
    IF qty > poi.ordered_quantity THEN
      RAISE EXCEPTION 'Delivery quantity on line % cannot exceed original PO quantity %',poi.line_no,poi.ordered_quantity;
    END IF;
    INSERT INTO public.vendor_delivery_challan_items (challan_id,po_item_id,quantity)
      VALUES (dc_id,poi.id,qty);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Add at least one dispatched line'; END IF;
  PERFORM public.log_event('delivery_challan_registered','Delivery Challan',dc_number,dc_id,NULL,NULL,
    jsonb_build_object('po_id',_po_id,'items',n,'photo_attached',true),'purchase_order',_po_id);
  RETURN dc_id;
END $$;
REVOKE ALL ON FUNCTION public.register_vendor_delivery_challan(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_vendor_delivery_challan(uuid,jsonb,jsonb) TO authenticated;
