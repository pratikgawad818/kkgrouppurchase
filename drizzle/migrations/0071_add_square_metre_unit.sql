-- Register square metres for flooring, plaster, waterproofing and other area-based items.
-- Master-data-only seed: no items, balances, stock movements or invoices are altered.
-- Code is company-scoped; replaying the migration cannot duplicate existing units.
INSERT INTO public.units_of_measure (
  company_id, code, name, decimal_places, status, is_demo
)
SELECT c.id, 'SQM', 'Square Metre', 2, 'active'::public.record_status, false
FROM public.companies AS c
ON CONFLICT (company_id, code) DO NOTHING;
