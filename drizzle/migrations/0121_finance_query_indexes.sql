-- Non-unique B-tree indexes for existing RLS-scoped finance and procurement lookups.
-- No changes to records, constraints, authorization, or accounting functions.
-- Build in a short maintenance transaction; abort rather than wait on a busy table.
SET LOCAL lock_timeout = '3s';
CREATE INDEX vi_project_id_scan_idx ON public.vendor_invoices (project_id, id);
CREATE INDEX vp_status_scan_idx ON public.vendor_payments (status, id);
CREATE INDEX vpa_invoice_lookup_idx ON public.vendor_payment_allocations (invoice_id);
CREATE INDEX vaa_invoice_lookup_idx ON public.vendor_advance_adjustments (invoice_id);
CREATE INDEX vaa_payment_lookup_idx ON public.vendor_advance_adjustments (advance_payment_id);
CREATE INDEX opa_invoice_history_idx ON public.opening_payment_amendments (invoice_id);
CREATE INDEX opa_pending_vendor_idx ON public.opening_payment_amendments (vendor_id, requested_at, id) WHERE status = 'pending';
CREATE INDEX je_source_lookup_idx ON public.journal_entries (company_id, source_type, source_id);
CREATE INDEX grn_project_scan_idx ON public.goods_receipt_notes (project_id, id);
CREATE INDEX sse_creator_date_idx ON public.site_small_expenses (created_by, spent_on DESC, id);
