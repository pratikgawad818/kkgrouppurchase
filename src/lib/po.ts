import type { Database } from "@/integrations/supabase/types";

export type PoStatus = Database["public"]["Enums"]["po_status"];
export type PoAction = Database["public"]["Enums"]["po_action"];
export type InvTxType = Database["public"]["Enums"]["inventory_tx_type"];

export const PO_STATUS: Record<PoStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  pending_approval: { label: "Pending approval", cls: "bg-warning/15 text-warning-foreground border-warning/40" },
  approved: { label: "Approved", cls: "bg-primary/10 text-primary border-primary/30" },
  rejected: { label: "Rejected", cls: "bg-destructive/10 text-destructive border-destructive/30" },
  sent: { label: "Sent to vendor", cls: "bg-primary/10 text-primary border-primary/30" },
  partially_received: { label: "Partially received", cls: "bg-warning/15 text-warning-foreground border-warning/40" },
  partially_accepted: { label: "Partially accepted", cls: "bg-warning/15 text-warning-foreground border-warning/40" },
  fully_received: { label: "Fully received", cls: "bg-success/15 text-success border-success/40" },
  short_closed: { label: "Short closed", cls: "bg-muted text-foreground" },
  closed: { label: "Closed", cls: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground line-through" },
};

export const PO_ACTION_LABEL: Record<PoAction, string> = {
  created: "Created", submitted: "Submitted for approval", approved: "Approved", rejected: "Rejected", sent: "Marked as sent", cancelled: "Cancelled", closed: "Closed",
};

export const TX_LABEL: Record<InvTxType, string> = {
  opening_stock: "Opening stock", goods_receipt: "Goods receipt", transfer_in: "Transfer in", transfer_out: "Transfer out", damage: "Damage", adjustment: "Adjustment", material_issue: "Material issue", material_return: "Material return", purchase_return: "Purchase return",
};

export const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export type GrnStatus = Database["public"]["Enums"]["grn_status"];
export const GRN_STATUS: Record<GrnStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  posted: { label: "Posted", cls: "bg-success/15 text-success border-success/40" },
  cancelled: { label: "Cancelled", cls: "bg-destructive/10 text-destructive border-destructive/30" },
};
