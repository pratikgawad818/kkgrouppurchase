ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'partially_accepted';
ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'short_closed';
DO $$ BEGIN
  CREATE TYPE public.grn_disposition AS ENUM ('pending_decision','replacement_expected','short_close','return_to_vendor','credit_note_expected','accepted_under_concession');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;