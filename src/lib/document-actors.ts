import { supabase } from "@/integrations/supabase/client";

export async function documentActorNames(
  kind: "purchase_order" | "vendor_payment" | "purchase_request",
  ids: readonly string[],
) {
  const names = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await supabase.rpc("document_actor_names", {
      _kind: kind,
      _ids: [...ids.slice(start, start + 100)],
    });
    if (error) throw error;
    for (const row of data ?? []) if (row.full_name) names.set(row.actor_id, row.full_name);
  }
  return names;
}
