-- 0066: Permanent retirement of the ERP Google Sheets OAuth/sync integration.
-- Do not touch native ERP operational data, legacy cost entries, archived import
-- documents, historical material usage or the existing append-only audit trail.
-- No active Google connection, token, OAuth state, HTTP nonce or scheduler remains.
DO $$
DECLARE job record; ignored boolean;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR job IN EXECUTE
      'SELECT jobid FROM cron.job WHERE jobname = ''kk-erp-google-sheets-5min''
         OR command ILIKE ''%erp_enqueue_google_sheets_sync%'''
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' INTO ignored USING job.jobid;
    END LOOP;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.erp_enqueue_google_sheets_sync();
DROP TABLE IF EXISTS public.erp_sheet_sync_nonces;
DROP TABLE IF EXISTS public.erp_google_oauth_states;
DROP TABLE IF EXISTS public.erp_google_sheet_connections;

-- Keep the audit history, but remove the integration-specific name.
ALTER TABLE public.erp_google_sheet_import_audit
  RENAME TO erp_historical_consumption_audit;

-- Historical usage remains an archived, read-only register and retains its
-- integrity guard and audit trigger for any future controlled corrections.
CREATE OR REPLACE FUNCTION public.erp_audit_historical_consumption()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.erp_historical_consumption_audit
    (company_id,reference,operation,previous_row,new_row)
  VALUES(NEW.company_id,NEW.reference,TG_OP,
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.erp_audit_historical_consumption()
  FROM PUBLIC,anon,authenticated;

-- The archive-only erp_sheet_import_documents table and the
-- erp_project_cost_entries.sheet_import_id FK are intentionally preserved:
-- deletion would orphan or erase previously reconciled project-cost evidence.
