-- Hardening after migrations 0012-0015.
-- Default Lovable/Supabase table grants include direct DML for anon and
-- authenticated. Existing RLS denies direct writes, but remove the grants
-- as a second independent defense. Source mutations remain audited SECDEF RPCs.
--
-- Do not revoke from postgres, service_role or Lovable's internal sandbox_exec.

REVOKE ALL PRIVILEGES ON TABLE
  public.director_approval_votes,
  public.vendor_delivery_challans,
  public.vendor_delivery_challan_items,
  public.material_issues,
  public.material_issue_items,
  public.material_returns,
  public.material_return_items,
  public.inventory_transactions
FROM PUBLIC, anon, authenticated;

-- Authenticated staff may read subject to company/project/role RLS.
GRANT SELECT ON TABLE
  public.director_approval_votes,
  public.vendor_delivery_challans,
  public.vendor_delivery_challan_items,
  public.material_issues,
  public.material_issue_items,
  public.material_returns,
  public.material_return_items,
  public.inventory_transactions
TO authenticated;

-- Enforce RPC-only mutations. This helper must never be public.
REVOKE ALL ON FUNCTION public.register_director_vote(text,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_material_stock(
  text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid,uuid,uuid,uuid,numeric)
  FROM PUBLIC, anon, authenticated;
