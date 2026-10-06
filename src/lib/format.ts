import type { Database } from "@/integrations/supabase/types";

export type UnitStatus = Database["public"]["Enums"]["unit_status"];
export type UnitType = Database["public"]["Enums"]["unit_type"];
export type ProjectStatus = Database["public"]["Enums"]["project_status"];
export type WorkStatus = Database["public"]["Enums"]["work_status"];
export type AppRole = Database["public"]["Enums"]["app_role"];

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Display-only formatting. Authoritative amounts are computed in the database. */
export function inr(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  return inrFmt.format(Number(v));
}

/** Compact Indian notation: ₹1.25 Cr, ₹45.2 L */
export function inrShort(v: number | string | null | undefined) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return inrFmt.format(n);
}

export function num(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  return numFmt.format(Number(v));
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const UNIT_STATUS: Record<UnitStatus, { label: string; tone: string }> = {
  available: { label: "Available", tone: "available" },
  hold: { label: "Hold", tone: "hold" },
  booked: { label: "Booked", tone: "booked" },
  agreement_pending: { label: "Agreement Pending", tone: "booked" },
  agreement_done: { label: "Agreement Done", tone: "agreement" },
  registered: { label: "Registered", tone: "registered" },
  possession_pending: { label: "Possession Pending", tone: "registered" },
  possession_completed: { label: "Possession Completed", tone: "possession" },
  cancelled: { label: "Withdrawn", tone: "cancelled" },
};

export const TONE_CLASSES: Record<string, { badge: string; cell: string; dot: string }> = {
  available: { badge: "bg-st-available/12 text-st-available border-st-available/30", cell: "bg-st-available/10 border-st-available/40 hover:bg-st-available/20", dot: "bg-st-available" },
  hold: { badge: "bg-st-hold/15 text-st-hold border-st-hold/40", cell: "bg-st-hold/15 border-st-hold/50 hover:bg-st-hold/25", dot: "bg-st-hold" },
  booked: { badge: "bg-st-booked/12 text-st-booked border-st-booked/30", cell: "bg-st-booked/12 border-st-booked/40 hover:bg-st-booked/20", dot: "bg-st-booked" },
  agreement: { badge: "bg-st-agreement/12 text-st-agreement border-st-agreement/30", cell: "bg-st-agreement/12 border-st-agreement/40", dot: "bg-st-agreement" },
  registered: { badge: "bg-st-registered/12 text-st-registered border-st-registered/30", cell: "bg-st-registered/12 border-st-registered/40", dot: "bg-st-registered" },
  possession: { badge: "bg-st-possession/12 text-st-possession border-st-possession/30", cell: "bg-st-possession/12 border-st-possession/40", dot: "bg-st-possession" },
  cancelled: { badge: "bg-st-cancelled/12 text-st-cancelled border-st-cancelled/30", cell: "bg-muted border-border text-muted-foreground hover:bg-muted/70", dot: "bg-st-cancelled" },
};

export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  "1bhk": "1 BHK", "2bhk": "2 BHK", "3bhk": "3 BHK", "4bhk": "4 BHK", shop: "Shop", office: "Office", other: "Other",
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planning", approval: "Approval", under_construction: "Under Construction", near_completion: "Near Completion",
  completed: "Completed", on_hold: "On Hold", cancelled: "Cancelled",
};

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  not_started: "Not Started", in_progress: "In Progress", on_hold: "On Hold", completed: "Completed",
};

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "Super Admin", director: "Management", sales_manager: "Sales Manager", sales_executive: "Sales Executive",
  accounts_manager: "Accounts Manager", purchase_manager: "Purchase Manager", site_engineer: "Site Engineer",
  project_manager: "Project Manager", accountant: "Accounts", store_manager: "Store Manager", auditor: "Auditor",
};

export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e) {
    const m = String((e as { message: string }).message);
    const d = parseDuplicateInvoice(m);
    if (d) return `This vendor bill number already exists for this vendor as ${d.number} (${d.status.replace(/_/g, " ")}).`;
    return m;
  }
  return "The request could not be completed.";
}

export function parseDuplicateInvoice(m: string) {
  const p = m.match(/DUPLICATE_INVOICE\|([0-9a-f-]+)\|([^|]+)\|(\w+)/);
  return p ? { id: p[1], number: p[2], status: p[3] } : null;
}
