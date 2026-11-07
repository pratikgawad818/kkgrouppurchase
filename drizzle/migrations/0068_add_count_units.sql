-- Add count-based units to each existing company without changing its unit master.
-- Re-running this migration is safe and keeps existing units, IDs and references intact.
INSERT INTO public.units_of_measure (
  company_id, code, name, decimal_places, status, is_demo
)
SELECT company.id, unit.code, unit.name, 0, 'active'::public.record_status, false
FROM public.companies AS company
CROSS JOIN (
  VALUES
    ('PCS', 'Pieces'),
    ('PERSON', 'Person'),
    ('PKT', 'Packets')
) AS unit(code, name)
ON CONFLICT (company_id, code) DO NOTHING;
