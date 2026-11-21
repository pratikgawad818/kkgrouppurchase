-- 0091 SECURITY: Company-scoped employee avatars.
-- A generic Supabase account must not download every staff avatar.
-- The original bucket remains private; uploads/updates/deletes by the
-- owner retain their existing separate storage policies.

CREATE OR REPLACE FUNCTION public.can_read_company_avatar(_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles viewer
    WHERE viewer.id=auth.uid()
      AND viewer.is_active
      AND viewer.company_id IS NOT NULL
      AND (
        -- Own recently uploaded file: permits existing upload/update workflow.
        split_part(_path,'/',1)=viewer.id::text
        OR EXISTS (
          SELECT 1 FROM public.profiles owner
          WHERE owner.company_id=viewer.company_id
            AND owner.is_active
            AND owner.avatar_url=_path
            AND split_part(_path,'/',1)=owner.id::text
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_company_avatar(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_company_avatar(text) TO authenticated;

DROP POLICY IF EXISTS "Avatar signed-in read" ON storage.objects;
CREATE POLICY "Avatar signed-in read" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id='avatars'
  AND public.can_read_company_avatar(name)
);
