-- 0065: Accounts Manager can maintain Finance Settings with tax.configure.
-- Director and Accountant remain read-only without company.manage or tax.configure.
-- Other company settings retain stricter company.manage permission.
-- Existing company and audit boundaries unchanged.
CREATE OR REPLACE FUNCTION public.update_finance_settings(_settings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE comp uuid; old jsonb; nw jsonb;
BEGIN
  IF NOT (has_permission(auth.uid(),'company.manage')
    OR has_permission(auth.uid(),'tax.configure')) THEN RAISE EXCEPTION 'No permission to change finance settings'; END IF;
  IF _settings IS NULL OR jsonb_typeof(_settings) <> 'object'
  THEN RAISE EXCEPTION 'Finance settings must be an object'; END IF;
  IF _settings ? 'tds_sections' AND jsonb_typeof(_settings->'tds_sections') <> 'array'
  THEN RAISE EXCEPTION 'TDS sections must be an array'; END IF;
  SELECT company_id INTO comp FROM profiles WHERE id = auth.uid();
  IF coalesce((_settings->>'qty_tolerance_pct')::numeric,0) < 0 OR coalesce((_settings->>'rate_tolerance_pct')::numeric,0) < 0 OR coalesce((_settings->>'value_tolerance')::numeric,0) < 0 THEN
    RAISE EXCEPTION 'Tolerances cannot be negative'; END IF;
  SELECT finance_settings INTO old FROM companies WHERE id = comp;
  nw := jsonb_build_object(
    'qty_tolerance_pct', coalesce((_settings->>'qty_tolerance_pct')::numeric,0),
    'rate_tolerance_pct', coalesce((_settings->>'rate_tolerance_pct')::numeric,0),
    'value_tolerance', coalesce((_settings->>'value_tolerance')::numeric,0),
    'tds_sections', coalesce(_settings->'tds_sections','[]'::jsonb));
  UPDATE companies SET finance_settings = nw, updated_at = now() WHERE id = comp;
  PERFORM log_event('finance_settings_changed', 'Finance settings', 'Company finance settings', comp, NULL, old, nw);
END $function$;
