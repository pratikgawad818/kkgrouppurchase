-- Disposable extension to the existing material_0015_disposable fixture.
-- We keep the minimal prerequisites for 0014's genuine delivery/GRN RPCs.
-- The fake 700-bag opening stock is REMOVED: receipt must supply all 700.

DELETE FROM public.inventory_transactions;
DELETE FROM public.warehouse_stock;

ALTER TABLE public.warehouse_stock
  ALTER COLUMN quantity_on_hand SET DEFAULT 0,
  ALTER COLUMN weighted_avg_cost SET DEFAULT 0,
  ALTER COLUMN total_value SET DEFAULT 0;
ALTER TABLE public.inventory_transactions
  ALTER COLUMN tx_date SET DEFAULT current_date;
ALTER TABLE public.inventory_transactions
  ADD COLUMN grn_id uuid,
  ADD COLUMN grn_item_id uuid,
  ADD COLUMN transfer_id uuid,
  ADD COLUMN adjustment_id uuid;

CREATE TYPE public.po_status AS ENUM
  ('draft','pending_approval','approved','rejected','sent',
   'partially_received','partially_accepted','fully_received','closed','cancelled');
CREATE TYPE public.grn_status AS ENUM ('draft','posted','cancelled');
CREATE TYPE public.grn_disposition AS ENUM ('pending_decision','replacement_expected');
CREATE TABLE public.vendors (
  id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id), company_name text
);
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY,
  po_number text UNIQUE NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  rfq_id uuid NOT NULL,
  purchase_request_id uuid NOT NULL,
  status public.po_status NOT NULL,
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY, po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  line_no integer NOT NULL,
  material_id uuid NOT NULL REFERENCES public.items(id),
  unit_id uuid NOT NULL REFERENCES public.units_of_measure(id),
  ordered_quantity numeric NOT NULL,
  received_quantity numeric NOT NULL DEFAULT 0,
  accepted_quantity numeric NOT NULL DEFAULT 0,
  short_closed_quantity numeric NOT NULL DEFAULT 0,
  taxable_amount numeric NOT NULL
);
CREATE TABLE public.vendor_delivery_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  challan_number text NOT NULL,
  challan_date date NOT NULL,
  vehicle_number text,
  invoice_reference text,
  remarks text,
  status text NOT NULL DEFAULT 'registered',
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  cancelled_by uuid REFERENCES public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text
);
CREATE TABLE public.vendor_delivery_challan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id uuid NOT NULL REFERENCES public.vendor_delivery_challans(id),
  po_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id),
  quantity numeric NOT NULL
);
CREATE TABLE public.goods_receipt_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  rfq_id uuid NOT NULL,
  purchase_request_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  received_date date NOT NULL,
  challan_id uuid REFERENCES public.vendor_delivery_challans(id),
  challan_number text,
  invoice_reference text,
  vehicle_number text,
  remarks text,
  received_by uuid NOT NULL REFERENCES public.profiles(id),
  status public.grn_status NOT NULL DEFAULT 'draft',
  posted_at timestamptz
);
CREATE TABLE public.goods_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.goods_receipt_notes(id),
  po_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id),
  material_id uuid NOT NULL REFERENCES public.items(id),
  unit_id uuid NOT NULL REFERENCES public.units_of_measure(id),
  ordered_quantity numeric NOT NULL,
  previously_received numeric NOT NULL,
  received_quantity numeric NOT NULL,
  damaged_quantity numeric NOT NULL,
  rejected_quantity numeric NOT NULL,
  accepted_quantity numeric NOT NULL,
  unit_cost numeric NOT NULL,
  remarks text,
  disposition public.grn_disposition,
  disposition_by uuid REFERENCES public.profiles(id),
  disposition_at timestamptz,
  challan_item_id uuid REFERENCES public.vendor_delivery_challan_items(id)
);
GRANT SELECT ON public.purchase_orders,public.purchase_order_items,public.vendors,
  public.vendor_delivery_challans,public.vendor_delivery_challan_items,
  public.goods_receipt_notes,public.goods_receipt_items TO authenticated;

-- RLS read-only filters emulate authenticated company/project scope for QA.
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own POs" ON public.purchase_orders FOR SELECT TO authenticated
USING (public.can_access_project(auth.uid(),project_id));
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own PO items" ON public.purchase_order_items FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.purchase_orders p WHERE p.id=po_id));
ALTER TABLE public.vendor_delivery_challans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own challans" ON public.vendor_delivery_challans FOR SELECT TO authenticated
USING (public.can_access_project(auth.uid(),project_id));
ALTER TABLE public.vendor_delivery_challan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own challan items" ON public.vendor_delivery_challan_items FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.vendor_delivery_challans h WHERE h.id=challan_id));
ALTER TABLE public.goods_receipt_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own GRNs" ON public.goods_receipt_notes FOR SELECT TO authenticated
USING (public.can_access_project(auth.uid(),project_id));
ALTER TABLE public.goods_receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own GRN items" ON public.goods_receipt_items FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.goods_receipt_notes h WHERE h.id=grn_id));

INSERT INTO public.vendors VALUES
 ('70000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Cement Supplier A'),
 ('70000000-0000-4000-8000-000000000011',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Supplier B');
INSERT INTO public.purchase_orders(
  id,po_number,company_id,vendor_id,project_id,building_id,rfq_id,purchase_request_id,status
) VALUES
 ('71000000-0000-4000-8000-000000000001','PO-2026-0001',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','70000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
 '72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','approved'),
 ('71000000-0000-4000-8000-000000000011','PO-2026-0002',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','70000000-0000-4000-8000-000000000011',
 '20000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000011',
 '72000000-0000-4000-8000-000000000011','73000000-0000-4000-8000-000000000011','approved');
INSERT INTO public.purchase_order_items(
 id,po_id,line_no,material_id,unit_id,ordered_quantity,taxable_amount
) VALUES
 ('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
  1,'60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',700,210000),
 ('74000000-0000-4000-8000-000000000011','71000000-0000-4000-8000-000000000011',
  1,'60000000-0000-4000-8000-000000000011',
  '50000000-0000-4000-8000-000000000001',80,28000);
