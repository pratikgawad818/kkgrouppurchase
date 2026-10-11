-- Synthetic scaffolding ONLY, used to exercise the exact migration 0015.
-- Warehouse is seeded with 700 bags: this fixture does NOT exercise GRN.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('qa.actor',true),'')::uuid
$$;
CREATE TYPE public.app_role AS ENUM
  ('super_admin','director','site_engineer','project_manager','store_manager','auditor');
CREATE TYPE public.inventory_tx_type AS ENUM
  ('opening_stock','goods_receipt','transfer_in','transfer_out','material_issue','material_return');
CREATE TABLE public.companies(id uuid PRIMARY KEY,name text);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),is_active boolean NOT NULL,full_name text);
CREATE TABLE public.projects(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL,record_status text NOT NULL DEFAULT 'active');
CREATE TABLE public.buildings(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES public.projects(id),name text NOT NULL);
CREATE TABLE public.warehouses(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),
 project_id uuid REFERENCES public.projects(id),name text NOT NULL,status text NOT NULL DEFAULT 'active');
CREATE TABLE public.units_of_measure(id uuid PRIMARY KEY,code text NOT NULL);
CREATE TABLE public.items(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),
 unit_id uuid NOT NULL REFERENCES public.units_of_measure(id),
 code text NOT NULL,name text NOT NULL,status text NOT NULL DEFAULT 'active');
CREATE TABLE public.warehouse_stock(
 warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
 material_id uuid NOT NULL REFERENCES public.items(id),
 quantity_on_hand numeric(14,3) NOT NULL,
 weighted_avg_cost numeric(14,4) NOT NULL,
 total_value numeric(16,2) NOT NULL,
 updated_at timestamptz DEFAULT now(),
 PRIMARY KEY(warehouse_id,material_id)
);
CREATE TABLE public.inventory_transactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 tx_date date NOT NULL,tx_type public.inventory_tx_type NOT NULL,
 warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
 material_id uuid NOT NULL REFERENCES public.items(id),
 project_id uuid REFERENCES public.projects(id),building_id uuid REFERENCES public.buildings(id),
 quantity_in numeric(14,3) DEFAULT 0,quantity_out numeric(14,3) DEFAULT 0,
 unit_cost numeric(14,4) NOT NULL,total_cost numeric(16,2) NOT NULL,
 balance_after numeric(14,3) NOT NULL,created_by uuid NOT NULL REFERENCES public.profiles(id),
 remarks text
);
CREATE TABLE public.permissions(code text PRIMARY KEY,module text,description text,sort_order integer);
CREATE TABLE public.user_roles(user_id uuid REFERENCES public.profiles(id),role public.app_role,
  PRIMARY KEY(user_id,role));
CREATE TABLE public.role_permissions(role public.app_role,permission_code text,
  PRIMARY KEY(role,permission_code));
CREATE TABLE public.user_project_assignments(user_id uuid,project_id uuid,PRIMARY KEY(user_id,project_id));
CREATE TABLE public.qa_doc_counters(doc text PRIMARY KEY, last_no integer NOT NULL DEFAULT 0);
CREATE TABLE public.qa_events(action text,document_id uuid,actor_id uuid,created_at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION public.ist_today() RETURNS date
  LANGUAGE sql STABLE AS $$SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date$$;
CREATE OR REPLACE FUNCTION public.has_permission(_user uuid,_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id
    WHERE r.user_id=_user AND p.is_active AND
       (r.role='super_admin' OR EXISTS (
         SELECT 1 FROM public.role_permissions rp
         WHERE rp.role=r.role AND rp.permission_code=_permission
       ))
  )
$$;
CREATE OR REPLACE FUNCTION public.can_access_project(_user uuid,_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.projects p JOIN public.profiles actor ON actor.id=_user
    WHERE p.id=_project AND actor.is_active AND actor.company_id=p.company_id
      AND (public.has_permission(_user,'projects.view_all') OR EXISTS (
        SELECT 1 FROM public.user_project_assignments a
        WHERE a.user_id=_user AND a.project_id=p.id
      ))
  )
$$;
CREATE OR REPLACE FUNCTION public.next_doc_number(_doc text,_prefix text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE last_num integer;
BEGIN
  INSERT INTO public.qa_doc_counters(doc,last_no) VALUES (_doc,1)
    ON CONFLICT(doc) DO UPDATE SET last_no=public.qa_doc_counters.last_no+1
    RETURNING last_no INTO last_num;
  RETURN _prefix || '-QA-' || lpad(last_num::text,4,'0');
END
$$;
CREATE OR REPLACE FUNCTION public.audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock source documents are immutable';
END
$$;
CREATE OR REPLACE FUNCTION public.log_event(
  _action text,_entity text,_document text,_id uuid,_old jsonb,_new jsonb,
  _detail jsonb,_scope text,_scope_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.qa_events(action,document_id,actor_id) VALUES(_action,_id,auth.uid());
END
$$;

GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public,auth TO authenticated;
GRANT SELECT ON public.companies,public.profiles,public.projects,public.buildings,public.warehouses,
 public.units_of_measure,public.items,public.warehouse_stock,public.inventory_transactions TO authenticated;

ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Actor's authorized inventory" ON public.warehouse_stock FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(),'inventory.view')
  AND EXISTS(
    SELECT 1 FROM public.warehouses w JOIN public.profiles p ON p.id=auth.uid()
    WHERE w.id=warehouse_stock.warehouse_id AND p.is_active AND w.company_id=p.company_id
      AND (w.project_id IS NULL OR public.can_access_project(auth.uid(),w.project_id))
  )
);
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Actor's authorized stock transactions" ON public.inventory_transactions
  FOR SELECT TO authenticated USING (
    public.has_permission(auth.uid(),'inventory.view') AND EXISTS(
      SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active
        AND p.company_id=inventory_transactions.company_id
    )
  );

INSERT INTO public.companies VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Construction Company A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Unrelated Company B');
INSERT INTO public.profiles VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,'Admin A'),
 ('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,'Site Worker A'),
 ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,'Viewer A'),
 ('10000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true,'Admin B');
INSERT INTO public.projects VALUES
 ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Green Heights','active'),
 ('20000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Other Company','active');
INSERT INTO public.buildings VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Tower A'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Tower B'),
 ('30000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000011','Other Tower');
INSERT INTO public.warehouses VALUES
 ('40000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',NULL,'Main Store','active'),
 ('40000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',NULL,'Other Store','active');
INSERT INTO public.units_of_measure VALUES
 ('50000000-0000-4000-8000-000000000001','BAG');
INSERT INTO public.items VALUES
 ('60000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','50000000-0000-4000-8000-000000000001','CEM','OPC Cement','active'),
 ('60000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','50000000-0000-4000-8000-000000000001','CEM-B','Other Cement','active');
INSERT INTO public.warehouse_stock(warehouse_id,material_id,quantity_on_hand,weighted_avg_cost,total_value)
 VALUES
 ('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',700,300,210000),
 ('40000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000011',80,350,28000);
INSERT INTO public.user_roles VALUES
 ('10000000-0000-4000-8000-000000000001','super_admin'),
 ('10000000-0000-4000-8000-000000000002','site_engineer'),
 ('10000000-0000-4000-8000-000000000003','auditor'),
 ('10000000-0000-4000-8000-000000000011','super_admin');
INSERT INTO public.role_permissions VALUES
 ('auditor','inventory.view'),('auditor','projects.view_all'),
 ('site_engineer','inventory.view');
INSERT INTO public.user_project_assignments VALUES
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001');
INSERT INTO public.inventory_transactions(
 company_id,tx_date,tx_type,warehouse_id,material_id,project_id,
 quantity_in,quantity_out,unit_cost,total_cost,balance_after,created_by,remarks
) VALUES (
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',public.ist_today(),'opening_stock',
 '40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',NULL,
 700,0,300,210000,700,'10000000-0000-4000-8000-000000000001',
 'QA opening stock (does not test GRN)'
);
