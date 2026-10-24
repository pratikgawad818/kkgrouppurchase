-- Google Sheets: database-driven 5-minute sync.
-- The scheduler generates a fresh, one-time 256-bit token for each HTTP request.
-- The server stores/compares only SHA-256 digests, never plaintext tokens.
-- No Google secrets or long-lived scheduler secret in SQL, GitHub, or the browser.
-- Prerequisites: migration 0056, pg_net. pg_cron job provisioned separately
-- after the matching server endpoint is deployed.
CREATE TABLE public.erp_sheet_sync_nonces (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX erp_sheet_sync_nonces_expires
  ON public.erp_sheet_sync_nonces (expires_at);

ALTER TABLE public.erp_sheet_sync_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_sheet_sync_nonces FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.erp_sheet_sync_nonces TO service_role;

CREATE OR REPLACE FUNCTION public.erp_enqueue_google_sheets_sync()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  nonce text;
  req_id bigint;
BEGIN
  -- Do not create a request for an empty or disconnected workbook.
  IF NOT EXISTS (
    SELECT 1 FROM public.erp_google_sheet_connections
    WHERE enabled = true AND oauth_refresh_token_ciphertext IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.erp_sheet_sync_nonces WHERE expires_at < now();
  nonce := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.erp_sheet_sync_nonces(token_hash, expires_at)
  VALUES (
    encode(extensions.digest(convert_to(nonce,'UTF8'), 'sha256'), 'hex'),
    now() + interval '120 seconds'
  );

  SELECT net.http_post(
    url := 'https://kkgrouppurchase.lovable.app/api/public/google-sheets-sync',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-erp-sheets-job-token',nonce
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO req_id;

  RETURN req_id;
END $$;

-- Invocations must only be performed by the database's privileged cron role.
REVOKE ALL ON FUNCTION public.erp_enqueue_google_sheets_sync()
  FROM PUBLIC, anon, authenticated;
