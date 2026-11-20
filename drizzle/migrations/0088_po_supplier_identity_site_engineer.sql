-- 0088: Allow a Site Engineer to see the supplier identity printed on an
-- assigned purchase order, without granting vendors.view or access to other
-- vendors, competitive quotations, bank accounts, or entire vendor records.
--
-- PostgREST embeds vendors(...) as NULL when the actor cannot pass the
-- vendor-master SELECT RLS policy (which requires vendors.view).

CREATE OR REPLACE FUNCTION public.get_po_supplier_for_document(_po_id uuid)
RETURNS TABLE (
  company_name text,
  gstin text,
  address text,
  city text,
  state text,
  pincode text,
  contact_person text,
  mobile text,
  email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  actor uuid := auth.uid();
  selected_po public.purchase_orders%ROWTYPE;
BEGIN
  IF actor IS NULL
     OR NOT public.is_active_user(actor)
     OR NOT public.has_permission(actor, 'purchase_order.view') THEN
    RAISE EXCEPTION 'Purchase-order supplier access denied';
  END IF;

  SELECT * INTO selected_po
  FROM public.purchase_orders po
  WHERE po.id = _po_id;

  IF NOT FOUND
     OR NOT public.po_can_view(selected_po.id)
     OR NOT public.actor_in_company(selected_po.company_id)
     OR NOT public.can_access_project(actor, selected_po.project_id) THEN
    RAISE EXCEPTION 'Purchase order not found or not accessible';
  END IF;

  -- Return ONLY the supplier attached to the authorised PO, never the
  -- vendor master or bank/payment fields. Verify same-company ownership
  -- independently of the PO's supplier foreign key.
  RETURN QUERY
    SELECT v.company_name, v.gstin, v.address, v.city, v.state,
           v.pincode, v.contact_person, v.mobile, v.email
    FROM public.vendors v
    WHERE v.id = selected_po.vendor_id
      AND v.company_id = selected_po.company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked purchase-order supplier is unavailable';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_po_supplier_for_document(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_po_supplier_for_document(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_po_supplier_for_document(uuid) IS
'Return only vendor identity/contact details for an active staff member with PO view permission and authorised company/project; no bank details or broad vendors.view grant.';
