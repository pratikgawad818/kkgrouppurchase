import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useAvatarUrl(path: string | null | undefined) {
  const query = useQuery({
    queryKey: ["avatar", path],
    enabled: !!path,
    staleTime: 30_000,
    gcTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("avatars").download(path!);
      if (error || !data) throw error ?? new Error("Could not load photo");
      return data;
    },
  });
  const blob = query.isSuccess ? query.data : undefined;
  const [local, setLocal] = useState<{ blob: Blob; path: string; url: string } | null>(null);
  useEffect(() => {
    if (!blob || !path) { setLocal(null); return; }
    const url = URL.createObjectURL(blob);
    setLocal({ blob, path, url });
    return () => URL.revokeObjectURL(url);
  }, [blob, path]);
  return { ...query, data: local && local.blob === blob && local.path === path ? local.url : undefined };
}
