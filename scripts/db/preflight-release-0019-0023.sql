-- KK GROUP ERP: READ-ONLY catalog inventory for pending migration release.
-- Does not read supplier, payment, phone, company, or customer records.
-- Does not apply migrations or change production configuration.
-- NOTE: object presence does NOT prove migration is correctly applied.

SELECT current_database() AS inspected_database,
       current_setting('TimeZone') AS session_timezone,
       (now() AT TIME ZONE 'Asia/Kolkata')::date AS india_business_date;

WITH expected(stage, asset, object_ref) AS (
 VALUES
 ('0019-0021','helper','public.actor_in_company(uuid)'),
 ('0019-0021','helper','public.can_access_project(uuid,uuid)'),
 ('0022','table','public.wa_vendor_consents'),
 ('0022','table','public.wa_consent_events'),
 ('0022','table','public.wa_notification_drafts'),
 ('0022','table','public.wa_notification_events'),
 ('0022','helper','public.wa_record_vendor_consent(uuid,boolean,text,text)'),
 ('0022','helper','public.wa_create_notification_draft(uuid,text,uuid,text)'),
 ('0023','table','public.site_small_expenses'),
 ('0023','table','public.site_small_expense_events'),
 ('0023','helper','public.record_site_small_expense(uuid,uuid,uuid,date,text,numeric,text,text,text,text)'),
 ('0023','helper','public.void_site_small_expense(uuid,text)')
)
SELECT stage,asset,object_ref,
  CASE WHEN asset='table' THEN to_regclass(object_ref) IS NOT NULL
       ELSE to_regprocedure(object_ref) IS NOT NULL END AS currently_exists
FROM expected ORDER BY stage,asset,object_ref;

-- Confirm the Drizzle migration ledger exists, but DO NOT assume the ledger
-- accurately reflects live state without comparing recorded SQL checksums.
SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL
  AS drizzle_migration_ledger_exists;

WITH tracked(table_name) AS (
 VALUES ('wa_vendor_consents'),('wa_consent_events'),
        ('wa_notification_drafts'),('wa_notification_events'),
        ('site_small_expenses'),('site_small_expense_events')
)
SELECT tracked.table_name,
  c.oid IS NOT NULL AS table_exists,
  coalesce(c.relrowsecurity,false) AS row_level_security_enabled,
  (SELECT count(*) FROM pg_catalog.pg_policies p
    WHERE p.schemaname='public' AND p.tablename=tracked.table_name)::int AS rls_policy_count,
  has_table_privilege('authenticated', to_regclass(format('public.%I',tracked.table_name)), 'SELECT')
    AS authenticated_select_privilege,
  has_table_privilege('authenticated', to_regclass(format('public.%I',tracked.table_name)), 'INSERT')
    AS authenticated_direct_insert_privilege,
  has_table_privilege('authenticated', to_regclass(format('public.%I',tracked.table_name)), 'UPDATE')
    AS authenticated_direct_update_privilege,
  has_table_privilege('authenticated', to_regclass(format('public.%I',tracked.table_name)), 'DELETE')
    AS authenticated_direct_delete_privilege
FROM tracked
LEFT JOIN pg_catalog.pg_class c ON c.oid=to_regclass(format('public.%I',tracked.table_name))
ORDER BY tracked.table_name;

-- A deployment gate is NOT complete without checking the migration history,
-- backing up the real DB, and manually testing with authenticated staff roles.
-- After schema rollout, direct INSERT/UPDATE/DELETE privilege should be false
-- on these new tables. Before rollout, missing tables are expected.
