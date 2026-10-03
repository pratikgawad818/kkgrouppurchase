import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

export type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];
export type MatchStatus = Database["public"]["Enums"]["match_status"];
export type PaymentStatus = Database["public"]["Enums"]["payment_status"];
export type PaymentKind = Database["public"]["Enums"]["payment_kind"];

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-border bg-muted text-muted-foreground" },
  pending_review: { label: "Matched · Pending approval", cls: "border-primary/30 bg-primary/10 text-primary" },
  exception: { label: "Exception", cls: "border-amber-300 bg-amber-50 text-amber-800" },
  approved: { label: "Approved · Unpaid", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  rejected: { label: "Rejected", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  partially_paid: { label: "Partially paid", cls: "border-sky-300 bg-sky-50 text-sky-800" },
  paid: { label: "Paid", cls: "border-emerald-400 bg-emerald-100 text-emerald-900" },
  cancelled: { label: "Cancelled", cls: "border-border bg-muted text-muted-foreground line-through" },
};
export const MATCH_STATUS: Record<MatchStatus, { label: string; cls: string }> = {
  pending: { label: "Not matched yet", cls: "border-border bg-muted text-muted-foreground" },
  matched: { label: "Matched", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  exception: { label: "Exception", cls: "border-amber-300 bg-amber-50 text-amber-800" },
};
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; cls: string }> = {
  scheduled: { label: "Scheduled", cls: "border-border bg-muted text-foreground" },
  approved: { label: "Approved", cls: "border-primary/30 bg-primary/10 text-primary" },
  recorded: { label: "Paid", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  cancelled: { label: "Cancelled", cls: "border-border bg-muted text-muted-foreground line-through" },
};
export const PAYMENT_MODES = [
  ["neft", "NEFT"], ["rtgs", "RTGS"], ["imps", "IMPS"], ["cheque", "Cheque"], ["upi", "UPI"], ["cash", "Cash"], ["other", "Other"],
] as const;
export const OPEN_INVOICE: InvoiceStatus[] = ["approved", "partially_paid"];

export type FinanceSettings = { qty_tolerance_pct: number; rate_tolerance_pct: number; value_tolerance: number; tds_sections: { code: string; label: string; rate: number }[] };

export async function uploadVendorDoc(folder: "invoices" | "payments", file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error("File must be under 20 MB");
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${folder}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from("vendor-documents").upload(path, file, file.type ? { contentType: file.type } : {});
  if (error) throw error;
  return path;
}
export async function openVendorDoc(path: string, download = false) {
  const { data, error } = await supabase.storage.from("vendor-documents").createSignedUrl(path, 300, download ? { download: true } : undefined);
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener");
}
export const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
export const badge = "rounded-sm border px-1.5 py-0.5 text-[11px] whitespace-nowrap";
