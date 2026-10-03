
CREATE TYPE public.invoice_status AS ENUM ('draft','pending_review','exception','approved','rejected','partially_paid','paid','cancelled');
CREATE TYPE public.match_status AS ENUM ('pending','matched','exception');
CREATE TYPE public.payment_status AS ENUM ('scheduled','approved','recorded','cancelled');
CREATE TYPE public.payment_kind AS ENUM ('invoice','advance');

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS finance_settings jsonb NOT NULL
  DEFAULT '{"qty_tolerance_pct":0,"rate_tolerance_pct":1,"value_tolerance":100,"tds_sections":[]}'::jsonb;

CREATE OR REPLACE FUNCTION public.next_fy_doc_number(_doc text, _prefix text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := (now() AT TIME ZONE 'Asia/Kolkata')::date; y int; v int;
BEGIN
  y := CASE WHEN extract(month from d) >= 4 THEN extract(year from d)::int ELSE extract(year from d)::int - 1 END;
  INSERT INTO doc_number_counters(doc, year, last_value) VALUES (_doc, y, 1)
  ON CONFLICT (doc, year) DO UPDATE SET last_value = doc_number_counters.last_value + 1
  RETURNING last_value INTO v;
  RETURN _prefix || '-' || y || '-' || lpad(v::text, 4, '0');
END $$;
REVOKE EXECUTE ON FUNCTION public.next_fy_doc_number(text,text) FROM PUBLIC, anon, authenticated;

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
GRANT SELECT ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ledger viewers read accounts" ON public.accounts FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ledger.view'));

INSERT INTO public.accounts(company_id, code, name, account_type)
SELECT c.id, a.code, a.name, a.t FROM public.companies c
CROSS JOIN (VALUES
  ('1100','Bank / Cash','asset'),
  ('1300','Inventory / Project Materials','asset'),
  ('1400','GST Input Credit','asset'),
  ('1500','Vendor Advances','asset'),
  ('2100','Accounts Payable - Vendors','liability'),
  ('2200','TDS Payable','liability')) a(code,name,t)
ON CONFLICT DO NOTHING;

CREATE TABLE public.vendor_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  vendor_invoice_number text NOT NULL,
  vendor_invoice_date date NOT NULL,
  due_date date,
  subtotal numeric(16,2) NOT NULL DEFAULT 0,
  tax_total numeric(16,2) NOT NULL DEFAULT 0,
  cgst numeric(16,2) NOT NULL DEFAULT 0,
  sgst numeric(16,2) NOT NULL DEFAULT 0,
  igst numeric(16,2) NOT NULL DEFAULT 0,
  freight numeric(16,2) NOT NULL DEFAULT 0 CHECK (freight >= 0),
  other_charges numeric(16,2) NOT NULL DEFAULT 0 CHECK (other_charges >= 0),
  grand_total numeric(16,2) NOT NULL DEFAULT 0,
  tds_section text,
  tds_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK (tds_rate >= 0 AND tds_rate <= 100),
  tds_amount numeric(16,2) NOT NULL DEFAULT 0,
  net_payable numeric(16,2) NOT NULL DEFAULT 0,
  amount_paid numeric(16,2) NOT NULL DEFAULT 0,
  advance_adjusted numeric(16,2) NOT NULL DEFAULT 0,
  balance_due numeric(16,2) NOT NULL DEFAULT 0,
  status public.invoice_status NOT NULL DEFAULT 'draft',
  match_status public.match_status NOT NULL DEFAULT 'pending',
  match_summary jsonb,
  attachment_path text,
  remarks text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, vendor_invoice_number)
);
CREATE INDEX vendor_invoices_vendor_idx ON public.vendor_invoices(vendor_id);
CREATE INDEX vendor_invoices_po_idx ON public.vendor_invoices(po_id);
CREATE INDEX vendor_invoices_status_idx ON public.vendor_invoices(status);

CREATE TABLE public.vendor_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  grn_id uuid NOT NULL REFERENCES public.goods_receipt_notes(id),
  grn_item_id uuid NOT NULL REFERENCES public.goods_receipt_items(id),
  po_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id),
  material_id uuid NOT NULL REFERENCES public.items(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  rate numeric(14,2) NOT NULL CHECK (rate >= 0),
  tax_type text NOT NULL DEFAULT 'cgst_sgst' CHECK (tax_type IN ('cgst_sgst','igst','none')),
  tax_rate_percent numeric(6,2) NOT NULL DEFAULT 0 CHECK (tax_rate_percent >= 0),
  taxable_amount numeric(16,2) NOT NULL DEFAULT 0,
  tax_amount numeric(16,2) NOT NULL DEFAULT 0,
  line_total numeric(16,2) NOT NULL DEFAULT 0,
  po_rate numeric(14,2) NOT NULL DEFAULT 0,
  po_tax_rate numeric(6,2) NOT NULL DEFAULT 0,
  available_quantity numeric(14,3) NOT NULL DEFAULT 0,
  qty_variance numeric(14,3) NOT NULL DEFAULT 0,
  rate_variance numeric(14,2) NOT NULL DEFAULT 0,
  tax_variance numeric(6,2) NOT NULL DEFAULT 0,
  match_ok boolean
);
CREATE INDEX vii_invoice_idx ON public.vendor_invoice_items(invoice_id);
CREATE INDEX vii_grn_item_idx ON public.vendor_invoice_items(grn_item_id);

CREATE TABLE public.vendor_invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id),
  action text NOT NULL,
  acted_by uuid REFERENCES public.profiles(id),
  acted_at timestamptz NOT NULL DEFAULT now(),
  comment text,
  previous_status public.invoice_status,
  new_status public.invoice_status
);
CREATE INDEX vie_invoice_idx ON public.vendor_invoice_events(invoice_id);

CREATE TABLE public.vendor_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  kind public.payment_kind NOT NULL,
  project_id uuid REFERENCES public.projects(id),
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  payment_mode text NOT NULL CHECK (payment_mode IN ('neft','rtgs','imps','cheque','upi','cash','other')),
  bank_account_id uuid REFERENCES public.company_bank_accounts(id),
  reference text,
  proof_path text,
  remarks text,
  status public.payment_status NOT NULL DEFAULT 'scheduled',
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendor_payments_vendor_idx ON public.vendor_payments(vendor_id);

CREATE TABLE public.vendor_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.vendor_payments(id),
  invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id),
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  UNIQUE (payment_id, invoice_id)
);

CREATE TABLE public.vendor_advance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_payment_id uuid NOT NULL REFERENCES public.vendor_payments(id),
  invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id),
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vendor_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.vendor_payments(id),
  action text NOT NULL,
  acted_by uuid REFERENCES public.profiles(id),
  acted_at timestamptz NOT NULL DEFAULT now(),
  comment text,
  previous_status public.payment_status,
  new_status public.payment_status
);

CREATE TABLE public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  entry_date date NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('vendor_invoice','vendor_payment','advance_adjustment')),
  source_id uuid NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id),
  project_id uuid REFERENCES public.projects(id),
  narration text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.journal_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.journal_entries(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  debit numeric(16,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(16,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit > 0) <> (credit > 0))
);
CREATE INDEX journal_lines_entry_idx ON public.journal_lines(entry_id);

GRANT SELECT ON public.vendor_invoices, public.vendor_invoice_items, public.vendor_invoice_events,
  public.vendor_payments, public.vendor_payment_allocations, public.vendor_advance_adjustments,
  public.vendor_payment_events, public.journal_entries, public.journal_lines TO authenticated;
GRANT ALL ON public.vendor_invoices, public.vendor_invoice_items, public.vendor_invoice_events,
  public.vendor_payments, public.vendor_payment_allocations, public.vendor_advance_adjustments,
  public.vendor_payment_events, public.journal_entries, public.journal_lines TO service_role;

ALTER TABLE public.vendor_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_invoice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_advance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.vi_can_view(_invoice_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM vendor_invoices i WHERE i.id = _invoice_id
    AND (has_permission(auth.uid(),'vendor_invoice.view') OR has_permission(auth.uid(),'payable.view'))
    AND can_access_project(auth.uid(), i.project_id))
$$;

CREATE POLICY "View invoices" ON public.vendor_invoices FOR SELECT TO authenticated
  USING ((public.has_permission(auth.uid(),'vendor_invoice.view') OR public.has_permission(auth.uid(),'payable.view'))
         AND public.can_access_project(auth.uid(), project_id));
CREATE POLICY "View invoice items" ON public.vendor_invoice_items FOR SELECT TO authenticated USING (public.vi_can_view(invoice_id));
CREATE POLICY "View invoice events" ON public.vendor_invoice_events FOR SELECT TO authenticated USING (public.vi_can_view(invoice_id));
CREATE POLICY "View payments" ON public.vendor_payments FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'payment.view'));
CREATE POLICY "View allocations" ON public.vendor_payment_allocations FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'payment.view'));
CREATE POLICY "View advance adjustments" ON public.vendor_advance_adjustments FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'payment.view'));
CREATE POLICY "View payment events" ON public.vendor_payment_events FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'payment.view'));
CREATE POLICY "View journals" ON public.journal_entries FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'ledger.view'));
CREATE POLICY "View journal lines" ON public.journal_lines FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'ledger.view'));

INSERT INTO public.permissions(code, module, description, sort_order) VALUES
 ('vendor_invoice.view','Finance','View vendor invoices',430),
 ('vendor_invoice.create','Finance','Create and edit vendor invoices',431),
 ('vendor_invoice.review','Finance','Review and match vendor invoices',432),
 ('vendor_invoice.approve','Finance','Approve matched vendor invoices',433),
 ('vendor_invoice.approve_exception','Finance','Approve invoice match exceptions',434),
 ('payable.view','Finance','View accounts payable',435),
 ('payment.view','Finance','View vendor payments',436),
 ('payment.schedule','Finance','Schedule vendor payments and advances',437),
 ('payment.approve','Finance','Approve vendor payments',438),
 ('payment.record','Finance','Record vendor payments and adjust advances',439),
 ('ledger.view','Finance','View vendor ledger and journals',440)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions(role, permission_code)
SELECT r::public.app_role, p FROM (VALUES
 ('director','vendor_invoice.view'),('director','vendor_invoice.create'),('director','vendor_invoice.review'),('director','vendor_invoice.approve'),('director','vendor_invoice.approve_exception'),
 ('director','payable.view'),('director','payment.view'),('director','payment.schedule'),('director','payment.approve'),('director','payment.record'),('director','ledger.view'),
 ('purchase_manager','vendor_invoice.view'),('purchase_manager','vendor_invoice.create'),('purchase_manager','vendor_invoice.review'),('purchase_manager','payable.view'),('purchase_manager','payment.view'),('purchase_manager','ledger.view'),
 ('accounts_manager','vendor_invoice.view'),('accounts_manager','vendor_invoice.create'),('accounts_manager','vendor_invoice.review'),('accounts_manager','vendor_invoice.approve'),
 ('accounts_manager','payable.view'),('accounts_manager','payment.view'),('accounts_manager','payment.schedule'),('accounts_manager','payment.record'),('accounts_manager','ledger.view'),
 ('accountant','vendor_invoice.view'),('accountant','vendor_invoice.review'),('accountant','vendor_invoice.approve'),
 ('accountant','payable.view'),('accountant','payment.view'),('accountant','payment.schedule'),('accountant','payment.record'),('accountant','ledger.view'),
 ('auditor','vendor_invoice.view'),('auditor','payable.view'),('auditor','payment.view'),('auditor','ledger.view')
) x(r,p) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.acct(_company uuid, _code text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM accounts WHERE company_id = _company AND code = _code
$$;

CREATE OR REPLACE FUNCTION public.post_journal(_company uuid, _date date, _src text, _src_id uuid, _vendor uuid, _project uuid, _narr text, _lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eid uuid; l jsonb; dr numeric := 0; cr numeric := 0;
BEGIN
  INSERT INTO journal_entries(entry_number, company_id, entry_date, source_type, source_id, vendor_id, project_id, narration, created_by)
  VALUES (next_fy_doc_number('JE','JE'), _company, _date, _src, _src_id, _vendor, _project, _narr, auth.uid()) RETURNING id INTO eid;
  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    IF coalesce((l->>'debit')::numeric,0) > 0 OR coalesce((l->>'credit')::numeric,0) > 0 THEN
      INSERT INTO journal_lines(entry_id, account_id, debit, credit)
      VALUES (eid, acct(_company, l->>'code'), coalesce((l->>'debit')::numeric,0), coalesce((l->>'credit')::numeric,0));
      dr := dr + coalesce((l->>'debit')::numeric,0); cr := cr + coalesce((l->>'credit')::numeric,0);
    END IF;
  END LOOP;
  IF round(dr,2) <> round(cr,2) THEN RAISE EXCEPTION 'Journal does not balance (% vs %)', dr, cr; END IF;
  RETURN eid;
END $$;

CREATE OR REPLACE FUNCTION public.grn_item_available(_grn_item uuid, _exclude_invoice uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gi.accepted_quantity - coalesce((SELECT sum(vii.quantity) FROM vendor_invoice_items vii
     JOIN vendor_invoices vi ON vi.id = vii.invoice_id
     WHERE vii.grn_item_id = _grn_item AND vi.status NOT IN ('rejected','cancelled')
       AND (_exclude_invoice IS NULL OR vi.id <> _exclude_invoice)),0)
  FROM goods_receipt_items gi WHERE gi.id = _grn_item
$$;

CREATE OR REPLACE FUNCTION public.vi_refresh_balance(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE paid numeric; adv numeric; inv record;
BEGIN
  SELECT * INTO inv FROM vendor_invoices WHERE id = _id;
  SELECT coalesce(sum(a.amount),0) INTO paid FROM vendor_payment_allocations a JOIN vendor_payments p ON p.id = a.payment_id
    WHERE a.invoice_id = _id AND p.status = 'recorded';
  SELECT coalesce(sum(amount),0) INTO adv FROM vendor_advance_adjustments WHERE invoice_id = _id;
  UPDATE vendor_invoices SET amount_paid = paid, advance_adjusted = adv,
    balance_due = net_payable - paid - adv,
    status = CASE WHEN inv.status IN ('approved','partially_paid','paid') THEN
      (CASE WHEN net_payable - paid - adv <= 0 THEN 'paid' WHEN paid + adv > 0 THEN 'partially_paid' ELSE 'approved' END)::invoice_status
      ELSE status END,
    updated_at = now()
  WHERE id = _id;
END $$;

CREATE OR REPLACE FUNCTION public.save_vendor_invoice(_id uuid, _header jsonb, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po record; inv record; it jsonb; gi record; poi record; avail numeric; q numeric; r numeric; tr numeric; tt text;
  tax numeric; ln int := 0; sub numeric := 0; taxsum numeric := 0; c numeric := 0; s numeric := 0; ig numeric := 0;
  fr numeric; oc numeric; gt numeric; tdsr numeric; tds numeric; vid uuid; prev invoice_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'vendor_invoice.create') THEN RAISE EXCEPTION 'No permission to create vendor invoices'; END IF;
  SELECT * INTO po FROM purchase_orders WHERE id = (_header->>'po_id')::uuid;
  IF po IS NULL OR NOT can_access_project(auth.uid(), po.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF po.status NOT IN ('partially_received','fully_received','closed') THEN RAISE EXCEPTION 'Goods must be received on this PO before invoicing'; END IF;
  IF coalesce(trim(_header->>'vendor_invoice_number'),'') = '' THEN RAISE EXCEPTION 'Vendor bill number is required'; END IF;
  IF (_header->>'vendor_invoice_date') IS NULL THEN RAISE EXCEPTION 'Vendor bill date is required'; END IF;
  IF jsonb_array_length(coalesce(_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Add at least one invoice line'; END IF;
  IF EXISTS (SELECT 1 FROM vendor_invoices WHERE vendor_id = po.vendor_id AND lower(vendor_invoice_number) = lower(trim(_header->>'vendor_invoice_number'))
             AND (_id IS NULL OR id <> _id)) THEN
    RAISE EXCEPTION 'Bill number % already exists for this vendor', trim(_header->>'vendor_invoice_number'); END IF;

  IF _id IS NULL THEN
    INSERT INTO vendor_invoices(invoice_number, company_id, vendor_id, po_id, project_id, building_id, vendor_invoice_number, vendor_invoice_date, created_by)
    VALUES (next_fy_doc_number('VI','VI'), po.company_id, po.vendor_id, po.id, po.project_id, po.building_id,
            trim(_header->>'vendor_invoice_number'), (_header->>'vendor_invoice_date')::date, auth.uid())
    RETURNING id INTO vid;
    prev := NULL;
  ELSE
    SELECT * INTO inv FROM vendor_invoices WHERE id = _id FOR UPDATE;
    IF inv IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF inv.status NOT IN ('draft','exception') THEN RAISE EXCEPTION 'Only draft or exception invoices can be edited'; END IF;
    IF inv.po_id <> po.id THEN RAISE EXCEPTION 'Purchase order cannot be changed'; END IF;
    vid := _id; prev := inv.status;
    DELETE FROM vendor_invoice_items WHERE invoice_id = vid;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT gi2.*, g.po_id AS g_po, g.status AS g_status INTO gi FROM goods_receipt_items gi2 JOIN goods_receipt_notes g ON g.id = gi2.grn_id WHERE gi2.id = (it->>'grn_item_id')::uuid;
    IF gi IS NULL OR gi.g_po <> po.id THEN RAISE EXCEPTION 'GRN line does not belong to this purchase order'; END IF;
    IF gi.g_status <> 'posted' THEN RAISE EXCEPTION 'Only posted goods receipts can be invoiced'; END IF;
    SELECT * INTO poi FROM purchase_order_items WHERE id = gi.po_item_id;
    q := (it->>'quantity')::numeric; r := (it->>'rate')::numeric;
    tr := coalesce((it->>'tax_rate_percent')::numeric, 0); tt := coalesce(it->>'tax_type', poi.tax_type);
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF r IS NULL OR r < 0 THEN RAISE EXCEPTION 'Enter a valid rate'; END IF;
    avail := grn_item_available(gi.id, vid);
    IF q > avail THEN RAISE EXCEPTION 'Cannot invoice % — only % accepted and not yet invoiced on this GRN line', q, avail; END IF;
    ln := ln + 1;
    tax := round(q * r * tr / 100, 2);
    INSERT INTO vendor_invoice_items(invoice_id, line_no, grn_id, grn_item_id, po_item_id, material_id, quantity, rate, tax_type, tax_rate_percent,
      taxable_amount, tax_amount, line_total, po_rate, po_tax_rate, available_quantity)
    VALUES (vid, ln, gi.grn_id, gi.id, poi.id, gi.material_id, q, r, tt, tr, round(q*r,2), tax, round(q*r,2) + tax, poi.rate, poi.tax_rate_percent, avail);
    sub := sub + round(q*r,2); taxsum := taxsum + tax;
    IF tt = 'igst' THEN ig := ig + tax; ELSIF tt = 'cgst_sgst' THEN c := c + round(tax/2,2); s := s + tax - round(tax/2,2); END IF;
  END LOOP;
  IF ln = 0 THEN RAISE EXCEPTION 'Add at least one invoice line with a quantity'; END IF;

  fr := coalesce((_header->>'freight')::numeric,0); oc := coalesce((_header->>'other_charges')::numeric,0);
  gt := sub + taxsum + fr + oc;
  tdsr := coalesce((_header->>'tds_rate')::numeric,0);
  tds := round((sub + fr + oc) * tdsr / 100, 2);
  UPDATE vendor_invoices SET
    vendor_invoice_number = trim(_header->>'vendor_invoice_number'),
    vendor_invoice_date = (_header->>'vendor_invoice_date')::date,
    due_date = nullif(_header->>'due_date','')::date,
    subtotal = sub, tax_total = taxsum, cgst = c, sgst = s, igst = ig, freight = fr, other_charges = oc, grand_total = gt,
    tds_section = nullif(trim(coalesce(_header->>'tds_section','')),''), tds_rate = tdsr, tds_amount = tds,
    net_payable = gt - tds, balance_due = gt - tds,
    attachment_path = coalesce(nullif(_header->>'attachment_path',''), attachment_path),
    remarks = nullif(trim(coalesce(_header->>'remarks','')),''),
    status = 'draft', match_status = 'pending', match_summary = NULL, updated_at = now()
  WHERE id = vid;
  INSERT INTO vendor_invoice_events(invoice_id, action, acted_by, previous_status, new_status)
  VALUES (vid, CASE WHEN prev IS NULL THEN 'created' ELSE 'edited' END, auth.uid(), prev, 'draft');
  RETURN vid;
END $$;

CREATE OR REPLACE FUNCTION public.run_invoice_match(_id uuid)
RETURNS match_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; fs jsonb; qt numeric; rt numeric; vt numeric; l record; ok boolean; all_ok boolean := true;
  expected numeric := 0; qv int := 0; rv int := 0; tv int := 0; res match_status; diff numeric;
BEGIN
  SELECT * INTO inv FROM vendor_invoices WHERE id = _id;
  SELECT finance_settings INTO fs FROM companies WHERE id = inv.company_id;
  qt := coalesce((fs->>'qty_tolerance_pct')::numeric,0); rt := coalesce((fs->>'rate_tolerance_pct')::numeric,0); vt := coalesce((fs->>'value_tolerance')::numeric,0);
  FOR l IN SELECT * FROM vendor_invoice_items WHERE invoice_id = _id LOOP
    ok := true;
    IF l.quantity > l.available_quantity * (1 + qt/100) THEN ok := false; qv := qv + 1; END IF;
    IF l.po_rate > 0 AND abs(l.rate - l.po_rate) > l.po_rate * rt / 100 THEN ok := false; rv := rv + 1;
    ELSIF l.po_rate = 0 AND l.rate > 0 THEN ok := false; rv := rv + 1; END IF;
    IF l.tax_rate_percent <> l.po_tax_rate THEN ok := false; tv := tv + 1; END IF;
    UPDATE vendor_invoice_items SET qty_variance = l.quantity - l.available_quantity, rate_variance = l.rate - l.po_rate,
      tax_variance = l.tax_rate_percent - l.po_tax_rate, match_ok = ok WHERE id = l.id;
    expected := expected + round(l.quantity * l.po_rate, 2) * (1 + l.po_tax_rate/100);
    all_ok := all_ok AND ok;
  END LOOP;
  diff := round((inv.subtotal + inv.tax_total) - expected, 2);
  IF abs(diff) > vt THEN all_ok := false; END IF;
  res := CASE WHEN all_ok THEN 'matched' ELSE 'exception' END;
  UPDATE vendor_invoices SET match_status = res,
    match_summary = jsonb_build_object('qty_variances', qv, 'rate_variances', rv, 'tax_variances', tv,
      'expected_total', round(expected,2), 'invoice_total', inv.subtotal + inv.tax_total, 'total_variance', diff,
      'tolerances', jsonb_build_object('qty_pct', qt, 'rate_pct', rt, 'value', vt))
  WHERE id = _id;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.invoice_transition(_id uuid, _action text, _comment text)
RETURNS invoice_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; nxt invoice_status; m match_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO inv FROM vendor_invoices WHERE id = _id FOR UPDATE;
  IF inv IS NULL OR NOT can_access_project(auth.uid(), inv.project_id) THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF _action = 'submit' THEN
    IF NOT (has_permission(auth.uid(),'vendor_invoice.create') OR has_permission(auth.uid(),'vendor_invoice.review')) THEN RAISE EXCEPTION 'No permission'; END IF;
    IF inv.status NOT IN ('draft','exception') THEN RAISE EXCEPTION 'Only draft invoices can be submitted'; END IF;
    m := run_invoice_match(_id);
    nxt := CASE WHEN m = 'matched' THEN 'pending_review' ELSE 'exception' END;
  ELSIF _action = 'approve' THEN
    IF NOT has_permission(auth.uid(),'vendor_invoice.approve') THEN RAISE EXCEPTION 'No permission to approve invoices'; END IF;
    IF inv.status <> 'pending_review' THEN RAISE EXCEPTION 'Only matched invoices pending review can be approved'; END IF;
    IF inv.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve an invoice you entered'; END IF;
    nxt := 'approved';
  ELSIF _action = 'approve_exception' THEN
    IF NOT has_permission(auth.uid(),'vendor_invoice.approve_exception') THEN RAISE EXCEPTION 'Only a Director can approve match exceptions'; END IF;
    IF inv.status <> 'exception' THEN RAISE EXCEPTION 'Invoice has no exception to approve'; END IF;
    IF inv.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve an invoice you entered'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A reason is required to approve an exception'; END IF;
    nxt := 'approved';
  ELSIF _action = 'reject' THEN
    IF NOT (has_permission(auth.uid(),'vendor_invoice.approve') OR has_permission(auth.uid(),'vendor_invoice.approve_exception')) THEN RAISE EXCEPTION 'No permission'; END IF;
    IF inv.status NOT IN ('pending_review','exception') THEN RAISE EXCEPTION 'Invoice is not awaiting a decision'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    nxt := 'rejected';
  ELSIF _action = 'cancel' THEN
    IF NOT has_permission(auth.uid(),'vendor_invoice.create') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF inv.status NOT IN ('draft','exception','rejected') THEN RAISE EXCEPTION 'Approved invoices cannot be cancelled'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
    nxt := 'cancelled';
  ELSE RAISE EXCEPTION 'Invalid action'; END IF;

  UPDATE vendor_invoices SET status = nxt, updated_at = now(),
    approved_by = CASE WHEN nxt = 'approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN nxt = 'approved' THEN now() ELSE approved_at END
  WHERE id = _id;

  IF nxt = 'approved' THEN
    PERFORM post_journal(inv.company_id, inv.vendor_invoice_date, 'vendor_invoice', inv.id, inv.vendor_id, inv.project_id,
      'Vendor invoice ' || inv.invoice_number || ' / bill ' || inv.vendor_invoice_number,
      jsonb_build_array(
        jsonb_build_object('code','1300','debit', inv.subtotal + inv.freight + inv.other_charges),
        jsonb_build_object('code','1400','debit', inv.tax_total),
        jsonb_build_object('code','2100','credit', inv.net_payable),
        jsonb_build_object('code','2200','credit', inv.tds_amount)));
  END IF;
  INSERT INTO vendor_invoice_events(invoice_id, action, acted_by, comment, previous_status, new_status)
  VALUES (_id, _action, auth.uid(), nullif(trim(_comment),''), inv.status, nxt);
  RETURN nxt;
END $$;

CREATE OR REPLACE FUNCTION public.schedule_vendor_payment(_header jsonb, _allocations jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; k payment_kind; v record; a jsonb; inv record; open_alloc numeric; tot numeric := 0; amt numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'payment.schedule') THEN RAISE EXCEPTION 'No permission to schedule payments'; END IF;
  k := (_header->>'kind')::payment_kind;
  SELECT * INTO v FROM vendors WHERE id = (_header->>'vendor_id')::uuid;
  IF v IS NULL THEN RAISE EXCEPTION 'Vendor not found'; END IF;
  IF (_header->>'payment_date') IS NULL THEN RAISE EXCEPTION 'Payment date is required'; END IF;
  IF k = 'advance' THEN
    amt := (_header->>'amount')::numeric;
    IF amt IS NULL OR amt <= 0 THEN RAISE EXCEPTION 'Enter the advance amount'; END IF;
    IF coalesce(trim(_header->>'remarks'),'') = '' THEN RAISE EXCEPTION 'A purpose is required for an advance'; END IF;
  ELSE
    IF jsonb_array_length(coalesce(_allocations,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Select at least one invoice to pay'; END IF;
    FOR a IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
      IF coalesce((a->>'amount')::numeric,0) <= 0 THEN CONTINUE; END IF;
      SELECT * INTO inv FROM vendor_invoices WHERE id = (a->>'invoice_id')::uuid FOR UPDATE;
      IF inv IS NULL OR inv.vendor_id <> v.id THEN RAISE EXCEPTION 'Invoice does not belong to this vendor'; END IF;
      IF inv.status NOT IN ('approved','partially_paid') THEN RAISE EXCEPTION 'Invoice % is not approved for payment', inv.invoice_number; END IF;
      SELECT coalesce(sum(al.amount),0) INTO open_alloc FROM vendor_payment_allocations al JOIN vendor_payments p ON p.id = al.payment_id
        WHERE al.invoice_id = inv.id AND p.status IN ('scheduled','approved');
      IF (a->>'amount')::numeric > inv.balance_due - open_alloc THEN
        RAISE EXCEPTION 'Invoice % has only % left to pay (incl. scheduled payments)', inv.invoice_number, inv.balance_due - open_alloc; END IF;
      tot := tot + (a->>'amount')::numeric;
    END LOOP;
    IF tot <= 0 THEN RAISE EXCEPTION 'Enter an amount to pay'; END IF;
    amt := tot;
  END IF;
  INSERT INTO vendor_payments(payment_number, company_id, vendor_id, kind, project_id, amount, payment_date, payment_mode, bank_account_id, reference, proof_path, remarks, created_by)
  VALUES (next_fy_doc_number(CASE WHEN k='advance' THEN 'VA' ELSE 'VP' END, CASE WHEN k='advance' THEN 'VA' ELSE 'VP' END), v.company_id, v.id, k,
    nullif(_header->>'project_id','')::uuid, amt, (_header->>'payment_date')::date, coalesce(_header->>'payment_mode','neft'),
    nullif(_header->>'bank_account_id','')::uuid, nullif(trim(coalesce(_header->>'reference','')),''), nullif(_header->>'proof_path',''),
    nullif(trim(coalesce(_header->>'remarks','')),''), auth.uid())
  RETURNING id INTO pid;
  IF k = 'invoice' THEN
    INSERT INTO vendor_payment_allocations(payment_id, invoice_id, amount)
    SELECT pid, (x->>'invoice_id')::uuid, (x->>'amount')::numeric FROM jsonb_array_elements(_allocations) x WHERE coalesce((x->>'amount')::numeric,0) > 0;
  END IF;
  INSERT INTO vendor_payment_events(payment_id, action, acted_by, new_status) VALUES (pid, 'scheduled', auth.uid(), 'scheduled');
  RETURN pid;
END $$;

CREATE OR REPLACE FUNCTION public.payment_transition(_id uuid, _action text, _comment text, _details jsonb)
RETURNS payment_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; nxt payment_status; a record; prev payment_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM vendor_payments WHERE id = _id FOR UPDATE;
  IF p IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  prev := p.status;
  IF _action = 'approve' THEN
    IF NOT has_permission(auth.uid(),'payment.approve') THEN RAISE EXCEPTION 'No permission to approve payments'; END IF;
    IF p.status <> 'scheduled' THEN RAISE EXCEPTION 'Only scheduled payments can be approved'; END IF;
    IF p.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve a payment you scheduled'; END IF;
    nxt := 'approved';
  ELSIF _action = 'record' THEN
    IF NOT has_permission(auth.uid(),'payment.record') THEN RAISE EXCEPTION 'No permission to record payments'; END IF;
    IF p.status <> 'approved' THEN RAISE EXCEPTION 'Only approved payments can be recorded'; END IF;
    IF coalesce(nullif(trim(coalesce(_details->>'reference','')),''), p.reference, '') = '' THEN RAISE EXCEPTION 'Enter the bank / UTR / cheque reference'; END IF;
    nxt := 'recorded';
  ELSIF _action = 'cancel' THEN
    IF NOT (has_permission(auth.uid(),'payment.schedule') OR has_permission(auth.uid(),'payment.approve')) THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status NOT IN ('scheduled','approved') THEN RAISE EXCEPTION 'Recorded payments cannot be cancelled'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
    nxt := 'cancelled';
  ELSE RAISE EXCEPTION 'Invalid action'; END IF;

  UPDATE vendor_payments SET status = nxt, updated_at = now(),
    approved_by = CASE WHEN nxt='approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN nxt='approved' THEN now() ELSE approved_at END,
    recorded_by = CASE WHEN nxt='recorded' THEN auth.uid() ELSE recorded_by END,
    recorded_at = CASE WHEN nxt='recorded' THEN now() ELSE recorded_at END,
    payment_date = CASE WHEN nxt='recorded' THEN coalesce(nullif(_details->>'payment_date','')::date, payment_date) ELSE payment_date END,
    reference = CASE WHEN nxt='recorded' THEN coalesce(nullif(trim(coalesce(_details->>'reference','')),''), reference) ELSE reference END,
    proof_path = CASE WHEN nxt='recorded' THEN coalesce(nullif(_details->>'proof_path',''), proof_path) ELSE proof_path END
  WHERE id = _id;

  IF nxt = 'recorded' THEN
    SELECT * INTO p FROM vendor_payments WHERE id = _id;
    PERFORM post_journal(p.company_id, p.payment_date, 'vendor_payment', p.id, p.vendor_id, p.project_id,
      CASE WHEN p.kind='advance' THEN 'Vendor advance ' ELSE 'Vendor payment ' END || p.payment_number || ' ref ' || p.reference,
      jsonb_build_array(
        jsonb_build_object('code', CASE WHEN p.kind='advance' THEN '1500' ELSE '2100' END, 'debit', p.amount),
        jsonb_build_object('code','1100','credit', p.amount)));
    FOR a IN SELECT invoice_id FROM vendor_payment_allocations WHERE payment_id = _id LOOP
      PERFORM vi_refresh_balance(a.invoice_id);
    END LOOP;
  END IF;
  INSERT INTO vendor_payment_events(payment_id, action, acted_by, comment, previous_status, new_status)
  VALUES (_id, _action, auth.uid(), nullif(trim(_comment),''), prev, nxt);
  RETURN nxt;
END $$;

CREATE OR REPLACE FUNCTION public.apply_vendor_advance(_advance_id uuid, _invoice_id uuid, _amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE adv record; inv record; used numeric; open_alloc numeric; aid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'payment.record') THEN RAISE EXCEPTION 'No permission to adjust advances'; END IF;
  SELECT * INTO adv FROM vendor_payments WHERE id = _advance_id FOR UPDATE;
  SELECT * INTO inv FROM vendor_invoices WHERE id = _invoice_id FOR UPDATE;
  IF adv IS NULL OR adv.kind <> 'advance' OR adv.status <> 'recorded' THEN RAISE EXCEPTION 'Advance must be recorded before it can be adjusted'; END IF;
  IF inv IS NULL OR inv.vendor_id <> adv.vendor_id THEN RAISE EXCEPTION 'Invoice belongs to a different vendor'; END IF;
  IF inv.status NOT IN ('approved','partially_paid') THEN RAISE EXCEPTION 'Invoice is not open for payment'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Enter an amount'; END IF;
  SELECT coalesce(sum(amount),0) INTO used FROM vendor_advance_adjustments WHERE advance_payment_id = _advance_id;
  IF _amount > adv.amount - used THEN RAISE EXCEPTION 'Only % of this advance is left', adv.amount - used; END IF;
  SELECT coalesce(sum(al.amount),0) INTO open_alloc FROM vendor_payment_allocations al JOIN vendor_payments p ON p.id = al.payment_id
    WHERE al.invoice_id = inv.id AND p.status IN ('scheduled','approved');
  IF _amount > inv.balance_due - open_alloc THEN RAISE EXCEPTION 'Invoice has only % left to settle', inv.balance_due - open_alloc; END IF;
  INSERT INTO vendor_advance_adjustments(advance_payment_id, invoice_id, amount, created_by) VALUES (_advance_id, _invoice_id, _amount, auth.uid()) RETURNING id INTO aid;
  PERFORM post_journal(inv.company_id, (now() AT TIME ZONE 'Asia/Kolkata')::date, 'advance_adjustment', aid, inv.vendor_id, inv.project_id,
    'Advance ' || adv.payment_number || ' adjusted against ' || inv.invoice_number,
    jsonb_build_array(jsonb_build_object('code','2100','debit',_amount), jsonb_build_object('code','1500','credit',_amount)));
  PERFORM vi_refresh_balance(_invoice_id);
END $$;

CREATE OR REPLACE FUNCTION public.update_finance_settings(_settings jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comp uuid;
BEGIN
  IF NOT has_permission(auth.uid(),'company.manage') THEN RAISE EXCEPTION 'No permission to change finance settings'; END IF;
  SELECT company_id INTO comp FROM profiles WHERE id = auth.uid();
  IF coalesce((_settings->>'qty_tolerance_pct')::numeric,0) < 0 OR coalesce((_settings->>'rate_tolerance_pct')::numeric,0) < 0 OR coalesce((_settings->>'value_tolerance')::numeric,0) < 0 THEN
    RAISE EXCEPTION 'Tolerances cannot be negative'; END IF;
  UPDATE companies SET finance_settings = jsonb_build_object(
    'qty_tolerance_pct', coalesce((_settings->>'qty_tolerance_pct')::numeric,0),
    'rate_tolerance_pct', coalesce((_settings->>'rate_tolerance_pct')::numeric,0),
    'value_tolerance', coalesce((_settings->>'value_tolerance')::numeric,0),
    'tds_sections', coalesce(_settings->'tds_sections','[]'::jsonb)), updated_at = now()
  WHERE id = comp;
END $$;

REVOKE EXECUTE ON FUNCTION public.post_journal(uuid,date,text,uuid,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vi_refresh_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_invoice_match(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acct(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vi_can_view(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.grn_item_available(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_vendor_invoice(uuid,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.invoice_transition(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.schedule_vendor_payment(jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.payment_transition(uuid,text,text,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_vendor_advance(uuid,uuid,numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_finance_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vi_can_view(uuid), public.grn_item_available(uuid,uuid), public.save_vendor_invoice(uuid,jsonb,jsonb),
  public.invoice_transition(uuid,text,text), public.schedule_vendor_payment(jsonb,jsonb), public.payment_transition(uuid,text,text,jsonb),
  public.apply_vendor_advance(uuid,uuid,numeric), public.update_finance_settings(jsonb) TO authenticated;

CREATE TRIGGER audit_vendor_invoices AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_vendor_payments AFTER INSERT OR UPDATE OR DELETE ON public.vendor_payments FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_vendor_advance_adjustments AFTER INSERT ON public.vendor_advance_adjustments FOR EACH ROW EXECUTE FUNCTION public.audit_row();

CREATE POLICY "Finance read vendor documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vendor-documents' AND (public.has_permission(auth.uid(),'vendor_invoice.view') OR public.has_permission(auth.uid(),'payment.view')));
CREATE POLICY "Finance upload vendor documents" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor-documents' AND (public.has_permission(auth.uid(),'vendor_invoice.create') OR public.has_permission(auth.uid(),'payment.schedule') OR public.has_permission(auth.uid(),'payment.record')));
