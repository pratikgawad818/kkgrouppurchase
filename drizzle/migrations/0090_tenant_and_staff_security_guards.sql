-- 0090 SECURITY: Close verified tenant access and unauthorized profile boundaries.
-- No business/stock/customer records are deleted or modified.
-- Existing explicit server-side administrator invitations create their staff
-- profiles with company_id, is_active=true and roles before first login.

-- A random signed-in account must not automatically become active in the
-- first company. All staff must be provisioned by an authorized admin.
ALTER TABLE public.profiles ALTER COLUMN is_active SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501';
  END IF;
  SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
  IF NOT FOUND OR NOT p.is_active OR p.company_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id)
  THEN
    RAISE EXCEPTION 'Staff access has not been enabled. Contact your administrator.'
      USING ERRCODE='42501';
  END IF;
  RETURN p;
END $$;
REVOKE ALL ON FUNCTION public.ensure_profile() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

-- Revoked project access overrides original authorship, including historic
-- requests and the linked detail pages.
DROP POLICY IF EXISTS "View PRs" ON public.purchase_requests;
CREATE POLICY "View PRs" ON public.purchase_requests FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(),'purchase_request.view')
  AND public.actor_in_company(company_id)
  AND public.can_access_project(auth.uid(),project_id)
);

-- Adjustment header and line items previously had unscoped inventory.view
-- policies; keep them readable only within the actor's company/site scope.
DROP POLICY IF EXISTS "Inventory viewers read adjustments" ON public.stock_adjustments;
CREATE POLICY "Inventory viewers read adjustments" ON public.stock_adjustments
FOR SELECT TO authenticated USING (
  public.has_permission(auth.uid(),'inventory.view')
  AND public.actor_in_company(company_id)
  AND EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id=stock_adjustments.warehouse_id AND w.company_id=stock_adjustments.company_id
      AND (w.project_id IS NULL OR public.can_access_project(auth.uid(),w.project_id))
  )
);
DROP POLICY IF EXISTS "Inventory viewers read adjustment items" ON public.stock_adjustment_items;
CREATE POLICY "Inventory viewers read adjustment items" ON public.stock_adjustment_items
FOR SELECT TO authenticated USING (
  public.has_permission(auth.uid(),'inventory.view')
  AND EXISTS (
    SELECT 1 FROM public.stock_adjustments a
    JOIN public.warehouses w ON w.id=a.warehouse_id AND w.company_id=a.company_id
    WHERE a.id=stock_adjustment_items.adjustment_id
      AND public.actor_in_company(a.company_id)
      AND (w.project_id IS NULL OR public.can_access_project(auth.uid(),w.project_id))
  )
);

-- A SECURITY DEFINER stock adjustment must verify the store belongs to the
-- actor's active company and assigned site, and every material is from that
-- same company. Role permission alone is NOT sufficient.
CREATE OR REPLACE FUNCTION public.create_stock_adjustment(
  _warehouse_id uuid, _kind public.adjustment_kind, _items jsonb, _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  actor uuid:=auth.uid();
  c uuid; site uuid;
  a uuid; it jsonb; m uuid; s record;
  sysq numeric; phys numeric; diff numeric; cost numeric; n int:=0;
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
    OR NOT public.has_permission(actor,'inventory.adjust') THEN
    RAISE EXCEPTION 'No permission to adjust stock';
  END IF;
  IF coalesce(btrim(_reason),'')='' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(_items) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Enter 1 to 500 materials';
  END IF;
  SELECT w.company_id,w.project_id INTO c,site
  FROM public.warehouses w WHERE w.id=_warehouse_id AND w.status='active';
  IF c IS NULL OR NOT public.actor_in_company(c)
    OR (site IS NOT NULL AND NOT public.can_access_project(actor,site)) THEN
    RAISE EXCEPTION 'Store is not accessible';
  END IF;

  INSERT INTO public.stock_adjustments(adjustment_number,company_id,warehouse_id,kind,reason,created_by)
  VALUES (
    public.next_doc_number(
      CASE WHEN _kind='opening_stock' THEN 'os' ELSE 'adj' END,
      CASE WHEN _kind='opening_stock' THEN 'OS' ELSE 'ADJ' END
    ),c,_warehouse_id,_kind,btrim(_reason),actor
  ) RETURNING id INTO a;

  FOR it IN SELECT value FROM jsonb_array_elements(_items) LOOP
    m:=(it->>'material_id')::uuid;
    CONTINUE WHEN m IS NULL;
    IF NOT EXISTS (
      SELECT 1 FROM public.items item WHERE item.id=m
        AND item.company_id=c AND item.status='active'
    ) THEN
      RAISE EXCEPTION 'Material is not active in the selected company';
    END IF;
    SELECT * INTO s FROM public.warehouse_stock
      WHERE warehouse_id=_warehouse_id AND material_id=m;
    sysq:=coalesce(s.quantity_on_hand,0);
    IF _kind='opening_stock' THEN
      diff:=coalesce((it->>'quantity')::numeric,0);
      cost:=coalesce((it->>'unit_cost')::numeric,0);
      CONTINUE WHEN diff<=0;
      IF EXISTS (
        SELECT 1 FROM public.inventory_transactions
        WHERE warehouse_id=_warehouse_id AND material_id=m
      ) THEN
        RAISE EXCEPTION 'Opening stock can only be entered for a material with no movements in this store';
      END IF;
      phys:=diff;
      PERFORM public.post_stock_x(c,'opening_stock',_warehouse_id,m,
        NULL,NULL,diff,0,cost,NULL,NULL,NULL,a,btrim(_reason));
    ELSE
      phys:=(it->>'physical_quantity')::numeric;
      CONTINUE WHEN phys IS NULL OR phys<0;
      diff:=phys-sysq;
      CONTINUE WHEN diff=0;
      cost:=coalesce(s.weighted_avg_cost,0);
      IF diff>0 THEN
        PERFORM public.post_stock_x(c,'adjustment',_warehouse_id,m,
          NULL,NULL,diff,0,cost,NULL,NULL,NULL,a,btrim(_reason));
      ELSE
        PERFORM public.post_stock_x(c,'adjustment',_warehouse_id,m,
          NULL,NULL,0,-diff,cost,NULL,NULL,NULL,a,btrim(_reason));
      END IF;
    END IF;
    INSERT INTO public.stock_adjustment_items(
      adjustment_id,material_id,system_quantity,physical_quantity,difference,unit_cost
    ) VALUES(a,m,sysq,phys,diff,cost);
    n:=n+1;
  END LOOP;
  IF n=0 THEN RAISE EXCEPTION 'No changes to post'; END IF;
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION public.create_stock_adjustment(uuid,public.adjustment_kind,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_stock_adjustment(uuid,public.adjustment_kind,jsonb,text) TO authenticated;

-- Transfer source and destination must both belong to the authenticated actor's
-- company and be accessible in project assignments. Every line's material is
-- checked against the same company before posting its stock movements.
CREATE OR REPLACE FUNCTION public.execute_stock_transfer(
  _from uuid,_to uuid,_items jsonb,_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  actor uuid:=auth.uid();
  t uuid; it jsonb; c uuid; dest_company uuid;
  from_project uuid; to_project uuid;
  m uuid; q numeric; cost numeric; n int:=0;
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
    OR NOT public.has_permission(actor,'inventory.transfer') THEN
    RAISE EXCEPTION 'No permission to transfer stock';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from=_to THEN
    RAISE EXCEPTION 'Source and destination must differ';
  END IF;
  IF coalesce(btrim(_reason),'')='' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(_items) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Enter 1 to 500 materials';
  END IF;
  SELECT w.company_id,w.project_id INTO c,from_project
  FROM public.warehouses w WHERE w.id=_from AND w.status='active';
  SELECT w.company_id,w.project_id INTO dest_company,to_project
  FROM public.warehouses w WHERE w.id=_to AND w.status='active';
  IF c IS NULL OR dest_company IS DISTINCT FROM c
    OR NOT public.actor_in_company(c)
    OR (from_project IS NOT NULL AND NOT public.can_access_project(actor,from_project))
    OR (to_project IS NOT NULL AND NOT public.can_access_project(actor,to_project))
  THEN RAISE EXCEPTION 'Source or destination store is not accessible'; END IF;

  INSERT INTO public.stock_transfers(
    transfer_number,company_id,from_warehouse_id,to_warehouse_id,reason,created_by
  ) VALUES (public.next_doc_number('st','ST'),c,_from,_to,btrim(_reason),actor)
  RETURNING id INTO t;
  FOR it IN SELECT value FROM jsonb_array_elements(_items) LOOP
    m:=(it->>'material_id')::uuid;
    q:=(it->>'quantity')::numeric;
    CONTINUE WHEN q IS NULL OR q<=0;
    IF NOT EXISTS (
      SELECT 1 FROM public.items item WHERE item.id=m
        AND item.company_id=c AND item.status='active'
    ) THEN
      RAISE EXCEPTION 'Material is not active in the selected company';
    END IF;
    cost:=public.post_stock(c,'transfer_out',_from,m,NULL,0,q,0,NULL,NULL,t,NULL);
    PERFORM public.post_stock(c,'transfer_in',_to,m,NULL,q,0,cost,NULL,NULL,t,NULL);
    INSERT INTO public.stock_transfer_items(transfer_id,material_id,quantity,unit_cost)
      VALUES(t,m,q,cost);
    n:=n+1;
  END LOOP;
  IF n=0 THEN RAISE EXCEPTION 'Add at least one material'; END IF;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.execute_stock_transfer(uuid,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.execute_stock_transfer(uuid,uuid,jsonb,text) TO authenticated;
