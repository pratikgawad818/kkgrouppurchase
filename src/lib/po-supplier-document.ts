import { supabase } from "@/integrations/supabase/client";

/** Only the identity/contact fields printed on the selected purchase order. */
export type PoSupplierForDocument = {
  company_name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  contact_person: string | null;
  mobile: string | null;
  email: string | null;
};

/**
 * A Site Engineer can read an assigned PO but not the vendor master.
 * The embedded vendors relation is therefore NULL for that role. Use the
 * narrowly scoped SECURITY DEFINER RPC instead of granting vendors.view.
 * This does not expose vendor bank details or other suppliers.
 *
 * Existing vendor-master viewers can keep using the already loaded relation;
 * on restricted roles an unavailable RPC fails instead of silently producing
 * an inaccurate supplier-less purchase order.
 */
export async function resolvePoSupplierForDocument(
  poId: string,
  embeddedVendor: PoSupplierForDocument | null | undefined,
): Promise<PoSupplierForDocument> {
  if (embeddedVendor?.company_name?.trim()) return embeddedVendor;

  const { data, error } = await supabase.rpc(
    "get_po_supplier_for_document" as never,
    { _po_id: poId } as never,
  );
  if (error) throw error;

  const [supplier] = (data ?? []) as PoSupplierForDocument[];
  if (!supplier?.company_name?.trim())
    throw new Error("Supplier details for this purchase order could not be verified.");
  return supplier;
}
