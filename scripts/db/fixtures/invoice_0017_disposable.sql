-- Disposable PostgreSQL-only fixture for invoice 0017 concurrency tests.
-- Synthetic identifiers, no production credentials, no Lovable connection.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('qa.actor',true),'')::uuid $$;

CREATE TYPE invoice_status AS ENUM ('draft','exception','pending_review','approved','rejected','cancelled','partially_paid','paid');
CREATE SEQUENCE qa_doc_seq;
CREATE TABLE purchase_orders (
 id uuid PRIMARY KEY, company_id uuid NOT NULL, vendor_id uuid NOT NULL,
 project_id uuid NOT NULL, building_id uuid, status text NOT NULL
);
CREATE TABLE purchase_order_items (
 id uuid PRIMARY KEY, po_id uuid NOT NULL, rate numeric NOT NULL,
 tax_type text NOT NULL, tax_rate_percent numeric NOT NULL
);
CREATE TABLE goods_receipt_notes (
 id uuid PRIMARY KEY, po_id uuid NOT NULL, status text NOT NULL
);
CREATE TABLE goods_receipt_items (
 id uuid PRIMARY KEY, grn_id uuid NOT NULL, po_item_id uuid NOT NULL,
 material_id uuid NOT NULL, accepted_quantity numeric NOT NULL
);
CREATE TABLE vendor_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_number text NOT NULL,
 company_id uuid NOT NULL, vendor_id uuid NOT NULL,
 po_id uuid NOT NULL, project_id uuid NOT NULL, building_id uuid,
 vendor_invoice_number text NOT NULL, vendor_invoice_date date NOT NULL,
 created_by uuid NOT NULL,
 status invoice_status NOT NULL DEFAULT 'draft',
 subtotal numeric NOT NULL DEFAULT 0, tax_total numeric NOT NULL DEFAULT 0,
 cgst numeric NOT NULL DEFAULT 0, sgst numeric NOT NULL DEFAULT 0,
 igst numeric NOT NULL DEFAULT 0, freight numeric NOT NULL DEFAULT 0,
 other_charges numeric NOT NULL DEFAULT 0, grand_total numeric NOT NULL DEFAULT 0,
 tds_section text, tds_rate numeric NOT NULL DEFAULT 0, tds_amount numeric NOT NULL DEFAULT 0,
 net_payable numeric NOT NULL DEFAULT 0, balance_due numeric NOT NULL DEFAULT 0,
 attachment_path text, remarks text, match_status text NOT NULL DEFAULT 'pending',
 match_summary jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vendor_invoice_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL, line_no integer NOT NULL,
 grn_id uuid NOT NULL, grn_item_id uuid NOT NULL,
 po_item_id uuid NOT NULL, material_id uuid NOT NULL,
 quantity numeric NOT NULL, rate numeric NOT NULL,
 tax_type text NOT NULL, tax_rate_percent numeric NOT NULL,
 taxable_amount numeric NOT NULL, tax_amount numeric NOT NULL,
 line_total numeric NOT NULL, po_rate numeric NOT NULL,
 po_tax_rate numeric NOT NULL, available_quantity numeric NOT NULL
);
CREATE TABLE vendor_invoice_events (
 invoice_id uuid NOT NULL, action text NOT NULL, acted_by uuid NOT NULL,
 previous_status invoice_status, new_status invoice_status NOT NULL
);
CREATE FUNCTION public.has_permission(_uid uuid,_perm text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT _uid='33333333-3333-4333-8333-333333333333'::uuid $$;
CREATE FUNCTION public.can_access_project(_uid uuid,_project uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT public.has_permission(_uid,'vendor_invoice.create') $$;
CREATE FUNCTION public.norm_bill_no(_t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace(coalesce(_t,''),'\s','','g')) $$;
CREATE FUNCTION public.next_fy_doc_number(_doc text,_prefix text) RETURNS text
LANGUAGE sql VOLATILE AS $$ SELECT _prefix||'-STAGE-'||nextval('qa_doc_seq')::text $$;
CREATE FUNCTION public.log_event(
 _action text,_doc_type text,_doc_number text,_record_id uuid,
 _reason text,_old jsonb,_new jsonb,_source_type text,_source_id uuid
) RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$;
CREATE FUNCTION public.grn_item_available(_grn_item uuid,_exclude_invoice uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
 SELECT gi.accepted_quantity - coalesce(
    (SELECT sum(li.quantity) FROM vendor_invoice_items li
     JOIN vendor_invoices vi ON vi.id=li.invoice_id
     WHERE li.grn_item_id=_grn_item AND vi.status NOT IN ('rejected','cancelled')
       AND (_exclude_invoice IS NULL OR vi.id<>_exclude_invoice)),0)
 FROM goods_receipt_items gi WHERE gi.id=_grn_item
$$;

INSERT INTO purchase_orders VALUES (
 '11111111-1111-4111-8111-000000000101',
 '11111111-1111-4111-8111-000000000001',
 '11111111-1111-4111-8111-000000000002',
 '11111111-1111-4111-8111-000000000003',
 NULL,'fully_received'
);
INSERT INTO purchase_order_items VALUES (
 '11111111-1111-4111-8111-000000000201',
 '11111111-1111-4111-8111-000000000101',
 100,'none',0
);
INSERT INTO goods_receipt_notes VALUES
 ('11111111-1111-4111-8111-000000000301','11111111-1111-4111-8111-000000000101','posted'),
 ('11111111-1111-4111-8111-000000000302','11111111-1111-4111-8111-000000000101','posted');
INSERT INTO goods_receipt_items VALUES
 ('11111111-1111-4111-8111-000000000401','11111111-1111-4111-8111-000000000301','11111111-1111-4111-8111-000000000201','11111111-1111-4111-8111-000000000501',10),
 ('11111111-1111-4111-8111-000000000402','11111111-1111-4111-8111-000000000302','11111111-1111-4111-8111-000000000201','11111111-1111-4111-8111-000000000501',10);
