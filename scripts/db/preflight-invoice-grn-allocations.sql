-- KK GROUP ERP invoice-allocation preflight. Read only; no changes.
-- Run in the intended Lovable Cloud SQL Editor before approving migration 0017.
BEGIN TRANSACTION READ ONLY;

-- A repeated GRN item within one invoice is unsafe: its invoice quantity can
-- be counted twice, even if each line individually appears within allowance.
SELECT vi.invoice_number, vii.invoice_id, vii.grn_item_id,
       count(*) AS duplicate_lines, sum(vii.quantity) AS invoiced_quantity
FROM public.vendor_invoice_items vii
JOIN public.vendor_invoices vi ON vi.id = vii.invoice_id
GROUP BY vi.invoice_number, vii.invoice_id, vii.grn_item_id
HAVING count(*) > 1
ORDER BY duplicate_lines DESC, vi.invoice_number;

-- Active invoice rows whose stored source references do not match the GRN
-- item they allocate. These rows need manual review before enforcing guards.
SELECT vi.invoice_number, vii.invoice_id, vii.id AS invoice_item_id,
       vii.grn_id AS stored_grn_id, gi.grn_id AS actual_grn_id,
       vii.po_item_id AS stored_po_item_id, gi.po_item_id AS actual_po_item_id,
       vii.material_id AS stored_material_id, gi.material_id AS actual_material_id
FROM public.vendor_invoice_items vii
JOIN public.vendor_invoices vi ON vi.id = vii.invoice_id
JOIN public.goods_receipt_items gi ON gi.id = vii.grn_item_id
WHERE vi.status NOT IN ('rejected','cancelled')
  AND (vii.grn_id <> gi.grn_id OR vii.po_item_id <> gi.po_item_id OR vii.material_id <> gi.material_id)
ORDER BY vi.invoice_number, vii.line_no;

-- Current active invoice allocations exceeding posted accepted receipt qty.
-- Rejected/cancelled invoices do not reserve accepted stock availability.
SELECT gi.id AS grn_item_id, g.grn_number, gi.accepted_quantity,
       sum(vii.quantity) AS active_invoiced_quantity,
       sum(vii.quantity) - gi.accepted_quantity AS over_invoiced_quantity
FROM public.goods_receipt_items gi
JOIN public.goods_receipt_notes g ON g.id = gi.grn_id
JOIN public.vendor_invoice_items vii ON vii.grn_item_id = gi.id
JOIN public.vendor_invoices vi ON vi.id = vii.invoice_id
WHERE vi.status NOT IN ('rejected','cancelled')
GROUP BY gi.id, g.grn_number, gi.accepted_quantity
HAVING sum(vii.quantity) > gi.accepted_quantity
ORDER BY over_invoiced_quantity DESC, g.grn_number;

-- Active invoices linked to a GRN that is no longer posted.
SELECT vi.invoice_number, g.grn_number, g.status AS grn_status,
       sum(vii.quantity) AS billed_quantity
FROM public.vendor_invoice_items vii
JOIN public.vendor_invoices vi ON vi.id = vii.invoice_id
JOIN public.goods_receipt_items gi ON gi.id = vii.grn_item_id
JOIN public.goods_receipt_notes g ON g.id = gi.grn_id
WHERE vi.status NOT IN ('rejected','cancelled') AND g.status <> 'posted'
GROUP BY vi.invoice_number, g.grn_number, g.status
ORDER BY vi.invoice_number, g.grn_number;

-- Assess whether the hardening is already deployed.
SELECT to_regclass('public.vendor_invoice_items_invoice_grn_uniq') IS NOT NULL
  AS invoice_grn_unique_index_present;

ROLLBACK;
