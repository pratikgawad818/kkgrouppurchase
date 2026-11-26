import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useAvatarUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["avatar", path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      // Fetched with the signed-in session, so access is re-checked and no reusable link exists.
      const { data, error } = await supabase.storage.from("avatars").download(path!);
      if (error || !data) throw error ?? new Error("Could not load photo");
      return URL.createObjectURL(data);
    },
  });
}

