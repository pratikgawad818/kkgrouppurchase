-- Register service billing category and hourly unit for machinery hire (e.g. JCB).
-- No inventory, invoice or stock movement is created by this master-data seed.
-- Keep existing company-specific master records; repeat execution is harmless.

INSERT INTO public.item_categories (company_id, code, name, status, is_demo)
SELECT c.id, 'SERVICES', 'Services', 'active'::public.record_status, false
FROM public.companies AS c
WHERE NOT EXISTS (
  SELECT 1 FROM public.item_categories AS existing
  WHERE existing.company_id = c.id AND lower(existing.name) = lower('Services')
)
ON CONFLICT DO NOTHING;

-- Two decimals allow part-hours (e.g. 2.50 hours) on machinery bills.
INSERT INTO public.units_of_measure (
  company_id, code, name, decimal_places, status, is_demo
)
SELECT c.id, 'HRS', 'Hours', 2, 'active'::public.record_status, false
FROM public.companies AS c
ON CONFLICT (company_id, code) DO NOTHING;
