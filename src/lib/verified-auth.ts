import { supabase } from "@/integrations/supabase/client";
import { makeVerifiedUserCache } from "./verified-user-cache";

/**
 * Route guard: reuse an already VERIFIED user for at most 12 seconds.
 * Backend data is always protected separately by Supabase session + RLS.
 */
const verified = makeVerifiedUserCache(async () => {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
});

export const getVerifiedRouteUser = verified.get;
export const invalidateVerifiedRouteUser = verified.invalidate;
