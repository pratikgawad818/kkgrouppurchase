-- Bounded batch wrapper reuses the existing authorized availability function.
-- No change to calculation, RLS, invoice validation, or underlying privileges.
CREATE FUNCTION public.grn_items_available(_grn_items uuid[], _exclude_invoice uuid)
RETURNS TABLE(grn_item_id uuid, available numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _grn_items IS NULL OR cardinality(_grn_items)>250 OR array_position(_grn_items,NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'Provide up to 250 non-null GRN item IDs';
  END IF;
  RETURN QUERY SELECT ids.id, public.grn_item_available(ids.id,_exclude_invoice)
  FROM (SELECT DISTINCT item AS id FROM unnest(_grn_items) AS u(item)) ids;
END
$function$;
REVOKE ALL ON FUNCTION public.grn_items_available(uuid[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.grn_items_available(uuid[],uuid) TO authenticated;
