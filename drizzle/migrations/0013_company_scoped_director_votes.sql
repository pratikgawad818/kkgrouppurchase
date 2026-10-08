-- Security hardening for the three-director approval ledger.
-- Apply AFTER 0012_three_director_approvals.sql, in a test environment first.
-- A director must belong to the same company as the document being approved.
-- The three active directors are counted PER COMPANY, never globally.

DROP POLICY IF EXISTS "Directors view approval votes" ON public.director_approval_votes;
DROP POLICY IF EXISTS "Company directors and admins view votes" ON public.director_approval_votes;

CREATE POLICY "Company directors and admins view votes"
ON public.director_approval_votes FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles viewer
    WHERE viewer.id = auth.uid()
      AND viewer.is_active
      AND (
        EXISTS (
          SELECT 1 FROM public.user_roles r
          WHERE r.user_id = viewer.id AND r.role = 'director'
        )
        OR public.has_permission(auth.uid(), 'users.manage')
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.purchase_orders po
          WHERE entity_type = 'purchase_order'
            AND entity_id = po.id
            AND po.company_id = viewer.company_id
        )
        OR EXISTS (
          SELECT 1 FROM public.vendor_payments pay
          WHERE entity_type = 'vendor_payment'
            AND entity_id = pay.id
            AND pay.company_id = viewer.company_id
        )
      )
  )
);

CREATE OR REPLACE FUNCTION public.register_director_vote(
  _type text, _id uuid, _decision text, _comment text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  vote_company uuid;
  eligible integer;
  approvals integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _type = 'purchase_order' THEN
    SELECT company_id INTO vote_company
    FROM public.purchase_orders WHERE id = _id;
  ELSIF _type = 'vendor_payment' THEN
    SELECT company_id INTO vote_company
    FROM public.vendor_payments WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'Unknown approval entity';
  END IF;
  IF vote_company IS NULL THEN RAISE EXCEPTION 'Approval document not found'; END IF;
  IF _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid director decision';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = auth.uid()
      AND r.role = 'director'
      AND p.is_active
      AND p.company_id = vote_company
  ) THEN
    RAISE EXCEPTION 'Only an active director of this company may vote';
  END IF;

  SELECT count(DISTINCT r.user_id) INTO eligible
  FROM public.user_roles r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.role = 'director'
    AND p.is_active
    AND p.company_id = vote_company;

  IF eligible <> 3 THEN
    RAISE EXCEPTION 'Exactly three active directors required for this company (currently %)', eligible;
  END IF;

  INSERT INTO public.director_approval_votes (
    entity_type, entity_id, actor_id, decision, comment
  ) VALUES (
    _type, _id, auth.uid(), _decision, nullif(trim(_comment), '')
  );

  SELECT count(*) INTO approvals
  FROM public.director_approval_votes
  WHERE entity_type = _type
    AND entity_id = _id
    AND decision = 'approved';

  RETURN approvals;
END $$;

REVOKE ALL ON FUNCTION public.register_director_vote(text,uuid,text,text) FROM PUBLIC, authenticated;
