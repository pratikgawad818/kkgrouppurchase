/** Official buyer frozen on PO creation. Older POs retain their historical
 * original workspace-company data rather than being retroactively reissued. */
export type BuyerIdentity = {
  name: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  registered_address: string | null;
  billing_address?: string | null;
  office_address: string | null;
  phone: string | null;
  email: string | null;
};
export interface PoBuyerSnapshot {
  buyer_legal_entity_id?: string | null;
  buyer_legal_name?: string | null;
  buyer_gstin?: string | null;
  buyer_pan?: string | null;
  buyer_registered_address?: string | null;
  buyer_billing_address?: string | null;
  buyer_phone?: string | null;
  buyer_email?: string | null;
  companies?: BuyerIdentity | null;
}
export function poBuyerIdentity(po: PoBuyerSnapshot): BuyerIdentity | null {
  if (!po.buyer_legal_entity_id) return po.companies ?? null;
  return {
    name: po.buyer_legal_name || "Registered buyer",
    legal_name: po.buyer_legal_name ?? null,
    gstin: po.buyer_gstin ?? null,
    pan: po.buyer_pan ?? null,
    registered_address: po.buyer_registered_address ?? null,
    billing_address: po.buyer_billing_address ?? po.buyer_registered_address ?? null,
    office_address: null,
    phone: po.buyer_phone ?? null,
    email: po.buyer_email ?? null,
  };
}
