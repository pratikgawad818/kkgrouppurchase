-- KK GROUP ERP: read-only migration preflight for 0012–0015.
-- Runs SELECTs against the currently connected database. DOES NOT deploy migrations,
-- run financial approvals, change warehouse stock or create test data.
-- Run only as a database administrator with access to the intended target.
-- On a production connection this reports metadata only.
BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS connected_database,
  current_user AS connected_role,
  now() AS checked_at,
  current_setting('server_version') AS postgres_version,
  to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS drizzle_migration_history_present;

-- Presence of database tables. A missing table means its migration is not fully present.
WITH required(object_name,migration) AS (
  VALUES
    ('director_approval_votes','0012'),
    ('vendor_delivery_challans','0014'),
    ('vendor_delivery_challan_items','0014'),
    ('material_issues','0015'),
    ('material_issue_items','0015'),
    ('material_returns','0015'),
    ('material_return_items','0015')
)
SELECT migration, object_name, to_regclass('public.'||object_name) IS NOT NULL AS present
FROM required ORDER BY migration,object_name;

-- Check that the SECURITY DEFINER RPCs exist. Merely existing does not verify
-- their deployed definition matches GitHub or that RLS/business rules are correct.
WITH required(function_name, signature,migration) AS (
  VALUES
    ('register_director_vote','public.register_director_vote(text,uuid,text,text)','0012/0013'),
    ('po_transition','public.po_transition(uuid,public.po_action,text)','0012'),
    ('payment_transition','public.payment_transition(uuid,text,text,jsonb)','0012'),
    ('register_vendor_delivery_challan','public.register_vendor_delivery_challan(uuid,jsonb,jsonb)','0014'),
    ('cancel_vendor_delivery_challan','public.cancel_vendor_delivery_challan(uuid,text)','0014'),
    ('create_goods_receipt','public.create_goods_receipt(uuid,uuid,jsonb,jsonb,boolean)','0014'),
    ('record_material_issue','public.record_material_issue(uuid,uuid,uuid,text,text,jsonb)','0015'),
    ('record_material_return','public.record_material_return(uuid,text,text,jsonb)','0015'),
    ('post_material_stock','public.post_material_stock(text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid,uuid,uuid,uuid,numeric)','0015'),
    ('project_material_consumption','public.project_material_consumption(uuid)','0015')
)
SELECT r.migration,r.function_name,
  to_regprocedure(r.signature) IS NOT NULL AS present,
  p.prosecdef AS security_definer,
  CASE WHEN p.oid IS NULL THEN NULL
    ELSE has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_may_execute
FROM required r
LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)
ORDER BY r.migration,r.function_name;

-- RLS must be enabled for all approval/dispatch/consumption tables.
WITH required(name,migration) AS (
  VALUES
  ('director_approval_votes','0012/0013'),
  ('vendor_delivery_challans','0014'),
  ('vendor_delivery_challan_items','0014'),
  ('material_issues','0015'),
  ('material_issue_items','0015'),
  ('material_returns','0015'),
  ('material_return_items','0015')
)
SELECT r.migration,r.name,c.relrowsecurity AS rls_enabled
FROM required r
LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||r.name)
ORDER BY r.migration,r.name;

-- Required reference columns: missing columns mean the release is incomplete.
WITH required(table_name,column_name,migration) AS (
 VALUES
 ('goods_receipt_notes','challan_id','0014'),
 ('goods_receipt_items','challan_item_id','0014'),
 ('inventory_transactions','material_issue_id','0015'),
 ('inventory_transactions','material_issue_item_id','0015'),
 ('inventory_transactions','material_return_id','0015'),
 ('inventory_transactions','material_return_item_id','0015')
)
SELECT r.migration,r.table_name,r.column_name,c.column_name IS NOT NULL AS present
FROM required r
LEFT JOIN information_schema.columns c
  ON c.table_schema='public' AND c.table_name=r.table_name
  AND c.column_name=r.column_name
ORDER BY r.migration,r.table_name,r.column_name;

-- Privilege verification. These source document tables must not offer direct
-- INSERT/UPDATE/DELETE to authenticated clients; only audited RPCs may write.
WITH protected(name) AS (
 VALUES
 ('director_approval_votes'),
 ('vendor_delivery_challans'),
 ('vendor_delivery_challan_items'),
 ('material_issues'),('material_issue_items'),
 ('material_returns'),('material_return_items'),
 ('inventory_transactions')
)
SELECT name,
   CASE WHEN to_regclass('public.'||name) IS NULL THEN NULL
    ELSE has_table_privilege('authenticated',to_regclass('public.'||name),'INSERT') END AS direct_insert,
   CASE WHEN to_regclass('public.'||name) IS NULL THEN NULL
    ELSE has_table_privilege('authenticated',to_regclass('public.'||name),'UPDATE') END AS direct_update,
   CASE WHEN to_regclass('public.'||name) IS NULL THEN NULL
    ELSE has_table_privilege('authenticated',to_regclass('public.'||name),'DELETE') END AS direct_delete
FROM protected ORDER BY name;

-- Company-level readiness. The workflow needs exactly 3 separate active
-- director accounts in each company. Do not create dummy production users.
SELECT p.company_id,COUNT(DISTINCT r.user_id) AS active_directors,
       COUNT(DISTINCT r.user_id)=3 AS exactly_three_ready
FROM public.profiles p
JOIN public.user_roles r ON r.user_id=p.id AND r.role='director'
WHERE p.is_active
GROUP BY p.company_id
ORDER BY p.company_id;

ROLLBACK;
