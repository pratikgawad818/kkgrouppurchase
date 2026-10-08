-- Material consumption: signed issue/return documents and immutable stock ledger.
-- Apply after 0014_vendor_delivery_challans.sql on staging first.
-- Issue is a stock OUT, return is a stock IN at the original issue unit cost.
-- Project cost = posted issue value minus linked return value.
-- This does not create a second AP/expense journal automatically.

CREATE TABLE public.material_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  issued_to text NOT NULL CHECK (length(btrim(issued_to)) BETWEEN 2 AND 120),
  purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 3 AND 500),
  issue_date date NOT NULL DEFAULT public.ist_today(),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_issues_project_date_idx ON public.material_issues(project_id,issue_date DESC);
CREATE INDEX material_issues_warehouse_idx ON public.material_issues(warehouse_id,created_at DESC);

CREATE TABLE public.material_issue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.material_issues(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL REFERENCES public.items(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  total_cost numeric(16,2) NOT NULL CHECK (total_cost >= 0),
  UNIQUE (issue_id,material_id)
);
CREATE INDEX material_issue_items_material_idx ON public.material_issue_items(material_id);

CREATE TABLE public.material_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number text NOT NULL UNIQUE,
  issue_id uuid NOT NULL REFERENCES public.material_issues(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  returned_by text NOT NULL CHECK (length(btrim(returned_by)) BETWEEN 2 AND 120),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  return_date date NOT NULL DEFAULT public.ist_today(),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_returns_issue_idx ON public.material_returns(issue_id,created_at DESC);
CREATE INDEX material_returns_project_idx ON public.material_returns(project_id,return_date DESC);

CREATE TABLE public.material_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.material_returns(id) ON DELETE RESTRICT,
  issue_item_id uuid NOT NULL REFERENCES public.material_issue_items(id),
  material_id uuid NOT NULL REFERENCES public.items(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  total_cost numeric(16,2) NOT NULL CHECK (total_cost >= 0),
  UNIQUE (return_id,issue_item_id)
);
CREATE INDEX material_return_items_issue_idx ON public.material_return_items(issue_item_id);

ALTER TABLE public.inventory_transactions
  ADD COLUMN material_issue_id uuid REFERENCES public.material_issues(id),
  ADD COLUMN material_issue_item_id uuid REFERENCES public.material_issue_items(id),
  ADD COLUMN material_return_id uuid REFERENCES public.material_returns(id),
  ADD COLUMN material_return_item_id uuid REFERENCES public.material_return_items(id);

CREATE INDEX inventory_tx_material_issue_idx ON public.inventory_transactions(material_issue_id);
CREATE INDEX inventory_tx_material_return_idx ON public.inventory_transactions(material_return_id);

INSERT INTO public.permissions(code,module,description,sort_order) VALUES
  ('inventory.issue','inventory','Issue materials to project works',423),
  ('inventory.return','inventory','Return unused material from project works',424)
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.role_permissions(role,permission_code)
SELECT role_name::public.app_role, permission_code
FROM (VALUES
 ('store_manager','inventory.issue'),
 ('store_manager','inventory.return'),
 ('site_engineer','inventory.issue'),
 ('site_engineer','inventory.return'),
 ('project_manager','inventory.issue'),
 ('project_manager','inventory.return'),
 ('director','inventory.issue'),
 ('director','inventory.return')
) AS grants(role_name,permission_code)
ON CONFLICT DO NOTHING;

ALTER TABLE public.material_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_issue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View company project material issues" ON public.material_issues
FOR SELECT TO authenticated USING (
  public.has_permission(auth.uid(),'inventory.view')
  AND public.can_access_project(auth.uid(),project_id)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active AND p.company_id=material_issues.company_id
  )
);
CREATE POLICY "View issue lines through issue" ON public.material_issue_items
FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.material_issues h WHERE h.id=issue_id)
);
CREATE POLICY "View company project material returns" ON public.material_returns
FOR SELECT TO authenticated USING (
  public.has_permission(auth.uid(),'inventory.view')
  AND public.can_access_project(auth.uid(),project_id)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active AND p.company_id=material_returns.company_id
  )
);
CREATE POLICY "View return lines through return" ON public.material_return_items
FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.material_returns h WHERE h.id=return_id)
);

GRANT SELECT ON public.material_issues,public.material_issue_items,public.material_returns,public.material_return_items TO authenticated;
GRANT ALL ON public.material_issues,public.material_issue_items,public.material_returns,public.material_return_items TO service_role;
-- No insert/update/delete grants or RLS write policies for authenticated clients.
CREATE TRIGGER material_issues_immutable BEFORE UPDATE OR DELETE ON public.material_issues
  FOR EACH ROW EXECUTE FUNCTION public.audit_immutable();
CREATE TRIGGER material_issue_items_immutable BEFORE UPDATE OR DELETE ON public.material_issue_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_immutable();
CREATE TRIGGER material_returns_immutable BEFORE UPDATE OR DELETE ON public.material_returns
  FOR EACH ROW EXECUTE FUNCTION public.audit_immutable();
CREATE TRIGGER material_return_items_immutable BEFORE UPDATE OR DELETE ON public.material_return_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_immutable();

-- Private transactional helper. The existing post_stock_x cannot carry source
-- issue/return FKs, so write source-linked ledger entries directly here.
CREATE OR REPLACE FUNCTION public.post_material_stock(
  _kind text, _company uuid, _warehouse uuid, _material uuid, _project uuid, _building uuid,
  _qty numeric, _source_cost numeric, _issue uuid, _issue_item uuid, _return uuid, _return_item uuid, _document_value numeric
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE stock record; cost numeric; remaining numeric; weighted numeric; inbound numeric; outbound numeric;
BEGIN
  IF _qty IS NULL OR _qty <= 0 OR round(_qty,3) <> _qty THEN
    RAISE EXCEPTION 'Quantity must be positive with at most three decimals';
  END IF;
  IF _kind NOT IN ('issue','return') THEN RAISE EXCEPTION 'Invalid stock movement'; END IF;
  IF _document_value IS NULL OR _document_value < 0 THEN RAISE EXCEPTION 'Invalid stock document valuation'; END IF;
  SELECT * INTO stock FROM public.warehouse_stock
    WHERE warehouse_id=_warehouse AND material_id=_material FOR UPDATE;
  IF _kind = 'issue' THEN
    IF stock IS NULL OR stock.quantity_on_hand < _qty THEN
      RAISE EXCEPTION 'Insufficient stock for material in selected store';
    END IF;
    IF _issue IS NULL OR _issue_item IS NULL OR _return IS NOT NULL OR _return_item IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid material issue source';
    END IF;
    cost := stock.weighted_avg_cost;
    remaining := stock.quantity_on_hand - _qty;
    weighted := CASE WHEN remaining > 0 THEN stock.weighted_avg_cost ELSE 0 END;
    inbound := 0; outbound := _qty;
  ELSE
    IF _issue IS NOT NULL OR _issue_item IS NOT NULL OR _return IS NULL OR _return_item IS NULL THEN
      RAISE EXCEPTION 'Invalid material return source';
    END IF;
    IF _source_cost IS NULL OR _source_cost < 0 THEN RAISE EXCEPTION 'Invalid original issue cost'; END IF;
    IF stock IS NULL THEN RAISE EXCEPTION 'Original receiving stock row not found'; END IF;
    cost := _source_cost;
    remaining := stock.quantity_on_hand + _qty;
    weighted := round(
      (stock.quantity_on_hand * stock.weighted_avg_cost + _qty * cost) / remaining,4
    );
    inbound := _qty; outbound := 0;
  END IF;
  UPDATE public.warehouse_stock SET
    quantity_on_hand=remaining,
    weighted_avg_cost=weighted,
    total_value=round(remaining*weighted,2),
    updated_at=now()
  WHERE warehouse_id=_warehouse AND material_id=_material;

  INSERT INTO public.inventory_transactions(
    company_id,tx_date,tx_type,warehouse_id,material_id,project_id,building_id,
    quantity_in,quantity_out,unit_cost,total_cost,balance_after,created_by,
    material_issue_id,material_issue_item_id,material_return_id,material_return_item_id,remarks
  ) VALUES (
    _company,public.ist_today(),
    CASE WHEN _kind='issue' THEN 'material_issue'::public.inventory_tx_type ELSE 'material_return'::public.inventory_tx_type END,
    _warehouse,_material,_project,_building,inbound,outbound,cost,_document_value,remaining,auth.uid(),
    _issue,_issue_item,_return,_return_item,
    CASE WHEN _kind='issue' THEN 'Issued for project work' ELSE 'Unused material returned to store' END
  );
  RETURN cost;
END $$;
REVOKE ALL ON FUNCTION public.post_material_stock(text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid,uuid,uuid,uuid,numeric)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_material_issue(
  _warehouse_id uuid,_project_id uuid,_building_id uuid,_issued_to text,_purpose text,_items jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w record; pr record; new_id uuid; line jsonb; material uuid; qty numeric; stock record;
        detail uuid; issue_no text; count_lines integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'inventory.issue') THEN
    RAISE EXCEPTION 'You do not have permission to issue materials';
  END IF;
  SELECT * INTO w FROM public.warehouses WHERE id=_warehouse_id AND status='active';
  SELECT * INTO pr FROM public.projects WHERE id=_project_id;
  IF w IS NULL OR pr IS NULL OR pr.company_id <> w.company_id OR pr.record_status <> 'active' THEN
    RAISE EXCEPTION 'Invalid source store or project';
  END IF;
  IF w.project_id IS NOT NULL AND w.project_id <> _project_id THEN
    RAISE EXCEPTION 'Store is assigned to another project';
  END IF;
  IF NOT public.can_access_project(auth.uid(),_project_id) OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND company_id=w.company_id
  ) THEN RAISE EXCEPTION 'No access to this project or company'; END IF;
  IF _building_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.buildings WHERE id=_building_id AND project_id=_project_id
  ) THEN RAISE EXCEPTION 'Building does not belong to the project'; END IF;
  IF length(btrim(coalesce(_issued_to,''))) NOT BETWEEN 2 AND 120 OR
     length(btrim(coalesce(_purpose,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Enter recipient name and purpose of issue';
  END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' OR jsonb_array_length(_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Include between 1 and 100 material lines';
  END IF;

  issue_no := public.next_doc_number('mi','MI');
  INSERT INTO public.material_issues(issue_number,company_id,warehouse_id,project_id,building_id,issued_to,purpose,created_by)
    VALUES(issue_no,w.company_id,_warehouse_id,_project_id,_building_id,btrim(_issued_to),btrim(_purpose),auth.uid())
    RETURNING id INTO new_id;
  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    material := nullif(line->>'material_id','')::uuid;
    qty := nullif(line->>'quantity','')::numeric;
    IF material IS NULL OR qty IS NULL OR qty <= 0 OR round(qty,3) <> qty THEN
      RAISE EXCEPTION 'Invalid material ID or quantity';
    END IF;
    SELECT * INTO stock FROM public.warehouse_stock
      WHERE warehouse_id=_warehouse_id AND material_id=material FOR UPDATE;
    IF stock IS NULL OR stock.quantity_on_hand < qty THEN
      RAISE EXCEPTION 'Insufficient stock for material';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.items WHERE id=material AND status='active' AND company_id=w.company_id) THEN
      RAISE EXCEPTION 'Material not active';
    END IF;
    INSERT INTO public.material_issue_items(issue_id,material_id,quantity,unit_cost,total_cost)
      VALUES(new_id,material,qty,stock.weighted_avg_cost,round(qty*stock.weighted_avg_cost,2))
      RETURNING id INTO detail;
    PERFORM public.post_material_stock('issue',w.company_id,_warehouse_id,material,_project_id,_building_id,qty,
       stock.weighted_avg_cost,new_id,detail,NULL,NULL,round(qty*stock.weighted_avg_cost,2));
    count_lines := count_lines + 1;
  END LOOP;
  PERFORM public.log_event('material_issue_posted','Material Issue',issue_no,new_id,NULL,NULL,
    jsonb_build_object('project',_project_id,'warehouse',_warehouse_id,'lines',count_lines),
    'project',_project_id);
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.record_material_issue(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_material_issue(uuid,uuid,uuid,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_material_return(
  _issue_id uuid,_returned_by text,_reason text,_items jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE original record; line jsonb; src record; qty numeric; returned numeric; credit_value numeric;
        return_id uuid; detail uuid; return_no text; count_lines integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'inventory.return') THEN
    RAISE EXCEPTION 'You do not have permission to return materials';
  END IF;
  SELECT * INTO original FROM public.material_issues WHERE id=_issue_id;
  IF original IS NULL OR NOT public.can_access_project(auth.uid(),original.project_id) OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND company_id=original.company_id
  ) THEN RAISE EXCEPTION 'Material issue not found or inaccessible'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses
     WHERE id=original.warehouse_id AND company_id=original.company_id AND status='active') THEN
    RAISE EXCEPTION 'Original store is no longer active; contact your store manager';
  END IF;
  IF length(btrim(coalesce(_returned_by,''))) NOT BETWEEN 2 AND 120 OR
     length(btrim(coalesce(_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Enter the person returning material and the reason';
  END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' OR jsonb_array_length(_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Include between 1 and 100 returned material lines';
  END IF;

  return_no := public.next_doc_number('mr','MR');
  INSERT INTO public.material_returns(return_number,issue_id,company_id,warehouse_id,project_id,
    building_id,returned_by,reason,created_by)
  VALUES(return_no,original.id,original.company_id,original.warehouse_id,original.project_id,
    original.building_id,btrim(_returned_by),btrim(_reason),auth.uid())
  RETURNING id INTO return_id;

  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO src FROM public.material_issue_items
      WHERE id=nullif(line->>'issue_item_id','')::uuid AND issue_id=original.id FOR UPDATE;
    IF src IS NULL THEN RAISE EXCEPTION 'Returned material is not on this issue'; END IF;
    qty := nullif(line->>'quantity','')::numeric;
    IF qty IS NULL OR qty <= 0 OR round(qty,3) <> qty THEN
      RAISE EXCEPTION 'Return quantity must be positive with at most three decimals';
    END IF;
    SELECT coalesce(sum(ri.quantity),0) INTO returned
    FROM public.material_return_items ri WHERE ri.issue_item_id=src.id;
    IF returned + qty > src.quantity THEN
      RAISE EXCEPTION 'Cannot return %. Only % remain on this original issue line',
        qty,src.quantity - returned;
    END IF;
    -- Cumulative rounding prevents multiple small returns from crediting
    -- more than the original issue line (e.g. two 1-unit returns at ₹0.005).
    credit_value := least(src.total_cost,round((returned+qty)*src.unit_cost,2))
      - least(src.total_cost,round(returned*src.unit_cost,2));
    INSERT INTO public.material_return_items(return_id,issue_item_id,material_id,quantity,unit_cost,total_cost)
      VALUES(return_id,src.id,src.material_id,qty,src.unit_cost,credit_value)
      RETURNING id INTO detail;
    PERFORM public.post_material_stock('return',original.company_id,original.warehouse_id,src.material_id,
      original.project_id,original.building_id,qty,src.unit_cost,NULL,NULL,return_id,detail,credit_value);
    count_lines := count_lines + 1;
  END LOOP;
  PERFORM public.log_event('material_return_posted','Material Return',return_no,return_id,NULL,NULL,
    jsonb_build_object('issue',original.id,'warehouse',original.warehouse_id,'lines',count_lines),
    'material_issue',original.id);
  RETURN return_id;
END $$;
REVOKE ALL ON FUNCTION public.record_material_return(uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_material_return(uuid,text,text,jsonb) TO authenticated;

-- Live project cost report: net material consumption valued at each issue's
-- weighted-average unit cost, less return credits at the ORIGINAL issue cost.
-- SQL aggregation prevents pagination-based cost understatement in the UI.
CREATE OR REPLACE FUNCTION public.project_material_consumption(_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  project_id uuid,
  project_name text,
  building_id uuid,
  building_name text,
  material_id uuid,
  material_code text,
  material_name text,
  unit_code text,
  issued_quantity numeric,
  returned_quantity numeric,
  net_quantity numeric,
  issued_value numeric,
  returned_value numeric,
  net_value numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH issues AS (
    SELECT h.project_id,h.building_id,i.material_id,
      sum(i.quantity) AS qty,sum(i.total_cost) AS value
    FROM public.material_issues h
    JOIN public.material_issue_items i ON i.issue_id=h.id
    GROUP BY h.project_id,h.building_id,i.material_id
  ),
  returns AS (
    SELECT h.project_id,h.building_id,i.material_id,
      sum(i.quantity) AS qty,sum(i.total_cost) AS value
    FROM public.material_returns h
    JOIN public.material_return_items i ON i.return_id=h.id
    GROUP BY h.project_id,h.building_id,i.material_id
  ),
  combined AS (
    SELECT coalesce(i.project_id,r.project_id) AS pid,
      coalesce(i.building_id,r.building_id) AS bid,
      coalesce(i.material_id,r.material_id) AS mid,
      coalesce(i.qty,0) AS issued_q, coalesce(i.value,0) AS issued_v,
      coalesce(r.qty,0) AS returned_q, coalesce(r.value,0) AS returned_v
    FROM issues i FULL JOIN returns r ON
      i.project_id=r.project_id
      AND i.building_id IS NOT DISTINCT FROM r.building_id
      AND i.material_id=r.material_id
  )
  SELECT p.id,p.name::text,c.bid,b.name::text,m.id,m.code::text,m.name::text,u.code::text,
    c.issued_q,c.returned_q,c.issued_q-c.returned_q,
    c.issued_v,c.returned_v,c.issued_v-c.returned_v
  FROM combined c
  JOIN public.projects p ON p.id=c.pid
  JOIN public.items m ON m.id=c.mid
  JOIN public.units_of_measure u ON u.id=m.unit_id
  LEFT JOIN public.buildings b ON b.id=c.bid
  JOIN public.profiles viewer ON viewer.id=auth.uid()
  WHERE viewer.is_active AND viewer.company_id=p.company_id
    AND public.has_permission(auth.uid(),'inventory.view')
    AND public.can_access_project(auth.uid(),p.id)
    AND (_project_id IS NULL OR p.id=_project_id)
  ORDER BY p.name,b.name NULLS FIRST,m.name;
$$;
REVOKE ALL ON FUNCTION public.project_material_consumption(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_material_consumption(uuid) TO authenticated;
