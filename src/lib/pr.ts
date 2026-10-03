import type { Database } from "@/integrations/supabase/types";

export type PrStatus = Database["public"]["Enums"]["pr_status"];
export type PrPriority = Database["public"]["Enums"]["pr_priority"];
export type PrType = Database["public"]["Enums"]["pr_request_type"];
export type PrAction = Database["public"]["Enums"]["pr_action"];

export const PR_STATUS: Record<PrStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-border bg-muted text-muted-foreground" },
  pending_approval: { label: "Pending Approval", cls: "border-primary/30 bg-primary/10 text-primary" },
  approved: { label: "Approved · Ready for RFQ", cls: "border-primary bg-primary text-primary-foreground" },
  rejected: { label: "Rejected", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelled", cls: "border-border bg-secondary text-muted-foreground line-through" },
};
export const PR_PRIORITY: Record<PrPriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const PR_TYPE: Record<PrType, string> = { material: "Material", equipment: "Equipment", service: "Service", other: "Other" };
export const PR_ACTION: Record<PrAction, string> = { created: "Created", submitted: "Submitted for approval", approved: "Approved", rejected: "Rejected", returned: "Returned for correction", cancelled: "Cancelled" };
