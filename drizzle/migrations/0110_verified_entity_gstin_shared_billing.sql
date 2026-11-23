-- 0110: KK Group legal buyers have separate GST identities and one shared
-- Bill To address. Do not mislabel a common billing location as the legal
-- registered address of every distinct GST registrant.
-- GSTIN/PAN from supplied documents; GSTIN checksum independently validated.
-- No historical PO, invoice, GRN, payment or audit data is rewritten.
ALTER TABLE public.legal_entities ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS buyer_billing_address text;

-- For this existing KK Group ERP tenant, management confirms a common
-- billing location equal to the head-office address stored in the company
-- master. This does not alter the individual registered addresses.
UPDATE public.legal_entities e
SET billing_address=c.registered_address,updated_at=now()
FROM public.companies c
WHERE e.company_id=c.id AND c.gstin='27AALFK3094R1ZG'
  AND e.code IN ('KKCON','KANESA','KKINFRA')
  AND nullif(btrim(coalesce(c.registered_address,'')),'') IS NOT NULL
  AND e.billing_address IS DISTINCT FROM c.registered_address;

UPDATE public.legal_entities e SET
  display_name='Kanesa Edifice',
  legal_name='KANESA EDIFICE PRIVATE LIMITED',
  gstin='27AAJCK7799N1ZC',
  pan='AAJCK7799N',
  updated_at=now()
FROM public.companies c
WHERE e.company_id=c.id AND c.gstin='27AALFK3094R1ZG'
  AND e.code='KANESA';
-- Kanesa registered address is NOT supplied in user's GSTIN screenshot.
-- Keep it NULL rather than treating the common billing address as registered.

UPDATE public.legal_entities e SET
  display_name='K K Infra',
  legal_name='K K Infra',
  gstin='27ABFFK4382H1Z4',
  pan='ABFFK4382H',
  registered_address=coalesce(
    nullif(e.registered_address,''),
    'Shop No. 6-A, Ground Floor, City Point, Kacheri Road, Palghar, Maharashtra'
  ),
  updated_at=now()
FROM public.companies c
WHERE e.company_id=c.id AND c.gstin='27AALFK3094R1ZG'
  AND e.code='KKINFRA';

-- Freeze both *legal registered address* and shared *bill-to address* on
-- each newly created PO. Old POs retain their historical stored identity.
CREATE OR REPLACE FUNCTION public.snapshot_po_legal_buyer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE entity public.legal_entities%ROWTYPE;
  project_tenant uuid;
  selected_entity uuid;
  enforce_mode boolean;
BEGIN
  SELECT legal_entity_mode INTO enforce_mode FROM public.companies
  WHERE id=NEW.company_id;
  IF NOT coalesce(enforce_mode,false) THEN RETURN NEW; END IF;
  SELECT p.company_id,p.legal_entity_id INTO project_tenant,selected_entity
    FROM public.projects p WHERE p.id=NEW.project_id;
  IF project_tenant IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'PO project does not belong to this ERP workspace';
  END IF;
  IF selected_entity IS NULL THEN
    RAISE EXCEPTION 'Assign this project to a legal entity in Company Settings before creating a PO';
  END IF;
  SELECT * INTO entity FROM public.legal_entities
    WHERE id=selected_entity AND company_id=NEW.company_id;
  IF entity.id IS NULL OR NOT entity.is_active THEN
    RAISE EXCEPTION 'Project legal entity is inactive or not available';
  END IF;
  IF nullif(btrim(coalesce(entity.legal_name,'')),'') IS NULL
    OR nullif(btrim(coalesce(entity.gstin,'')),'') IS NULL
    OR nullif(btrim(coalesce(entity.billing_address,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Complete legal name, GSTIN and billing address for % in Company Settings before creating a PO',
      entity.display_name;
  END IF;
  NEW.buyer_legal_entity_id:=entity.id;
  NEW.buyer_legal_name:=entity.legal_name;
  NEW.buyer_gstin:=entity.gstin;
  NEW.buyer_pan:=entity.pan;
  NEW.buyer_registered_address:=entity.registered_address;
  NEW.buyer_billing_address:=entity.billing_address;
  NEW.buyer_phone:=entity.phone;
  NEW.buyer_email:=entity.email;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.guard_po_buyer_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF (NEW.buyer_legal_entity_id,NEW.buyer_legal_name,NEW.buyer_gstin,
      NEW.buyer_pan,NEW.buyer_registered_address,NEW.buyer_billing_address,NEW.buyer_phone,NEW.buyer_email)
    IS DISTINCT FROM
     (OLD.buyer_legal_entity_id,OLD.buyer_legal_name,OLD.buyer_gstin,
      OLD.buyer_pan,OLD.buyer_registered_address,OLD.buyer_billing_address,OLD.buyer_phone,OLD.buyer_email)
  THEN RAISE EXCEPTION 'PO buyer identity is immutable; issue a documented correction'; END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.snapshot_po_legal_buyer() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_po_buyer_snapshot() FROM PUBLIC,anon,authenticated;
COMMENT ON COLUMN public.legal_entities.billing_address IS
'Common or entity-specific Bill To address. Separate from statutory registered_address; cannot replace the legal name and GSTIN.';
COMMENT ON COLUMN public.purchase_orders.buyer_billing_address IS
'Frozen Bill To address from legal entity at PO creation. Existing issued POs remain unchanged.';
