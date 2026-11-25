import { supabase } from "@/integrations/supabase/client";
import { collectGrnAvailability } from "@/lib/grn-availability-collect";

// Migration 0120; generated Supabase types are refreshed separately.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db=supabase as any;
export function loadBatchedGrnAvailability(ids:readonly string[],excludeInvoice:string|null){
  return collectGrnAvailability(ids,async batch=>await db.rpc("grn_items_available",{
    _grn_items:batch,_exclude_invoice:excludeInvoice
  }));
}
