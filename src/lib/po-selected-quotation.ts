import { supabase } from "@/integrations/supabase/client";

/**
 * Returns only the quotation that an accessible PO actually selected.
 * The RLS-protected vendor_quotations embedded relation is intentionally not
 * used: it is NULL for Site Engineers who cannot see competing vendor bids.
 * Server RPC 0086 checks active actor, company, project and PO view permission.
 */
export type SelectedPoQuotation = {
  quotation_id: string;
  quotation_number: string | null;
  attachment_path: string | null;
  quotation_date: string | null;
  payment_terms: string | null;
  remarks: string | null;
};

export async function fetchSelectedPoQuotation(
  poId: string,
): Promise<SelectedPoQuotation | null> {
  const { data, error } = await supabase.rpc(
    "get_po_selected_supplier_quotation" as never,
    { _po_id: poId } as never,
  );
  if (error) throw error;
  const selected = (data ?? []) as SelectedPoQuotation[];
  return selected[0] ?? null;
}
