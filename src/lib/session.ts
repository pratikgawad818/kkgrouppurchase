import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "./format";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: profile, error } = await supabase.rpc("ensure_profile");
      if (error) throw error;
      const [perms, roles] = await Promise.all([
        supabase.rpc("my_permissions"),
        supabase.from("user_roles").select("role").eq("user_id", profile.id),
      ]);
      if (perms.error) throw perms.error;
      if (roles.error) throw roles.error;
      return {
        profile,
        permissions: new Set<string>(perms.data ?? []),
        roles: (roles.data ?? []).map((r) => r.role as AppRole),
      };
    },
  });
}

export function useCan() {
  const { data } = useMe();
  return (code: string) => !!data?.permissions.has(code);
}
