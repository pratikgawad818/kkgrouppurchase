-- 0117: Allow authorized bank managers to delete only unreferenced,
-- non-primary company bank accounts. No historical financial records change.
-- The existing audit_company_bank_accounts DELETE trigger records every removal.
CREATE OR REPLACE FUNCTION public.delete_unused_company_bank_account(
  _account_id uuid, _last_four text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  account public.company_bank_accounts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL
    OR NOT public.is_active_user(auth.uid())
    OR NOT public.has_permission(auth.uid(), 'company.bank.manage')
    OR NOT (
      public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'accounts_manager')
    ) THEN
    RAISE EXCEPTION 'Only Super Admin or Accounts Manager can delete unused bank accounts';
  END IF;

  -- Row lock serializes removal against new payments referencing this account.
  -- Existing FK to vendor_payments.bank_account_id provides a second safeguard.
  SELECT * INTO account
  FROM public.company_bank_accounts
  WHERE id = _account_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(account.company_id) THEN
    RAISE EXCEPTION 'Bank account not found or not accessible';
  END IF;
  IF _last_four IS DISTINCT FROM right(account.account_number, 4) THEN
    RAISE EXCEPTION 'Bank account confirmation does not match';
  END IF;
  IF account.is_primary THEN
    RAISE EXCEPTION 'Assign a different primary bank account before deleting this one';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vendor_payments vp
    WHERE vp.bank_account_id = account.id
  ) THEN
    RAISE EXCEPTION 'Bank account is linked to payments and cannot be deleted. Mark it inactive instead';
  END IF;

  DELETE FROM public.company_bank_accounts
  WHERE id = account.id AND company_id = account.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account was not deleted';
  END IF;
  RETURN 'Bank account deleted';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Bank account is referenced by financial records. Mark it inactive instead';
END
$function$;

REVOKE ALL ON FUNCTION public.delete_unused_company_bank_account(uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_unused_company_bank_account(uuid,text)
  TO authenticated;
COMMENT ON FUNCTION public.delete_unused_company_bank_account(uuid,text) IS
'Super Admin/Accounts Manager may delete only unused, non-primary same-company bank accounts; row locks, FK and existing audit trigger preserve accounting integrity.';
