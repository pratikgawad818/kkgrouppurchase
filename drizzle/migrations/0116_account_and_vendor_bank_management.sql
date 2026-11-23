-- 0116: Scoped bank master for Super Admin and Accounts Manager.
-- Existing company accounts, vendor rows, financial transactions and payment
-- references are preserved. No historical bank details are rewritten.
INSERT INTO public.permissions(code,module,description,sort_order)
VALUES ('company.bank.manage','Company',
        'Create and edit company bank details (Super Admin and Accounts Manager only)',13)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions(role,permission_code)
VALUES ('super_admin','company.bank.manage'),
       ('accounts_manager','company.bank.manage')
ON CONFLICT DO NOTHING;

ALTER TABLE public.company_bank_accounts
  ADD COLUMN IF NOT EXISTS account_holder_name text,
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE RESTRICT;

-- Bind accounts to the correct legal buyer without silently assigning legacy
-- accounts to a GSTIN. Existing rows remain "Unassigned" until verified.
CREATE OR REPLACE FUNCTION public.guard_company_bank_legal_entity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'Bank account company cannot be changed';
  END IF;
  IF NEW.legal_entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.legal_entities e
    WHERE e.id=NEW.legal_entity_id
      AND e.company_id=NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Bank account legal entity must belong to the same company';
  END IF;
  IF length(btrim(NEW.account_name)) < 2
     OR length(btrim(NEW.bank_name)) < 2 THEN
    RAISE EXCEPTION 'Enter a bank account label and bank name';
  END IF;
  IF NEW.account_holder_name IS NOT NULL
     AND length(NEW.account_holder_name) > 160 THEN
    RAISE EXCEPTION 'Account holder name is too long';
  END IF;
  IF TG_OP='INSERT' OR NEW.account_number IS DISTINCT FROM OLD.account_number THEN
    IF NEW.account_number !~ '^[0-9]{6,25}$' THEN
      RAISE EXCEPTION 'Enter a bank account number with 6–25 digits';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.guard_company_bank_legal_entity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_company_bank_legal_entity_write ON public.company_bank_accounts;
CREATE TRIGGER guard_company_bank_legal_entity_write
BEFORE INSERT OR UPDATE ON public.company_bank_accounts
FOR EACH ROW EXECUTE FUNCTION public.guard_company_bank_legal_entity();

-- Replace the broad company.manage-only ALL policy with deliberately
-- narrow bank-management permissions; no user-facing DELETE policy.
DROP POLICY IF EXISTS "Manage bank accounts" ON public.company_bank_accounts;
DROP POLICY IF EXISTS "Bank managers insert" ON public.company_bank_accounts;
DROP POLICY IF EXISTS "Bank managers update" ON public.company_bank_accounts;
CREATE POLICY "Bank managers insert" ON public.company_bank_accounts
FOR INSERT TO authenticated
WITH CHECK (public.actor_in_company(company_id)
 AND public.has_permission(auth.uid(),'company.bank.manage'));
CREATE POLICY "Bank managers update" ON public.company_bank_accounts
FOR UPDATE TO authenticated
USING (public.actor_in_company(company_id)
 AND public.has_permission(auth.uid(),'company.bank.manage'))
WITH CHECK (public.actor_in_company(company_id)
 AND public.has_permission(auth.uid(),'company.bank.manage'));
REVOKE DELETE,TRUNCATE ON public.company_bank_accounts FROM anon,authenticated;

-- A Purchase Manager may still update ordinary vendor profile details,
-- but cannot alter the supplier's sensitive payout account. Only Super Admin
-- and Accounts Manager can create or change the vendor's bank information.
CREATE OR REPLACE FUNCTION public.guard_vendor_bank_edit_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF NEW.bank_account_name IS DISTINCT FROM OLD.bank_account_name
     OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
     OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
     OR NEW.ifsc IS DISTINCT FROM OLD.ifsc THEN
    IF auth.uid() IS NULL OR NOT public.actor_in_company(OLD.company_id)
       OR NOT public.has_permission(auth.uid(),'vendors.manage')
       OR NOT (public.has_role(auth.uid(),'super_admin')
               OR public.has_role(auth.uid(),'accounts_manager')) THEN
      RAISE EXCEPTION 'Only Super Admin or Accounts Manager can edit supplier bank details';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Cannot move bank details to another company';
    END IF;
    IF coalesce(NEW.bank_account_number,'') <> '' THEN
      IF NEW.bank_account_number !~ '^[0-9]{6,25}$'
        OR length(btrim(coalesce(NEW.bank_name,''))) < 2
        OR length(btrim(coalesce(NEW.bank_account_name,''))) < 2
        OR upper(coalesce(NEW.ifsc,'')) !~ '^[A-Z]{4}0[A-Z0-9]{6}$' THEN
        RAISE EXCEPTION 'Complete the supplier bank, holder name, account number and IFSC';
      END IF;
    ELSIF NEW.bank_account_name IS NOT NULL OR NEW.bank_name IS NOT NULL OR NEW.ifsc IS NOT NULL THEN
      RAISE EXCEPTION 'Clear all supplier bank fields together or enter complete details';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.guard_vendor_bank_edit_roles() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_vendor_bank_edit_roles_update ON public.vendors;
CREATE TRIGGER guard_vendor_bank_edit_roles_update
BEFORE UPDATE OF bank_account_name,bank_name,bank_account_number,ifsc
ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_bank_edit_roles();

COMMENT ON FUNCTION public.guard_vendor_bank_edit_roles() IS
'Prevents other vendor-editing roles from changing payout instructions; audited vendor rows and existing financial allocations are preserved.';
