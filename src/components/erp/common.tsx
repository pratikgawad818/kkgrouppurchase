import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, UNIT_STATUS, type UnitStatus } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export function PageHeader({ title, subtitle, actions, crumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {crumbs && <div className="mb-1 text-xs text-muted-foreground">{crumbs}</div>}
        <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function UnitStatusBadge({ status, className }: { status: UnitStatus; className?: string }) {
  const s = UNIT_STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE_CLASSES[s.tone]?.badge, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_CLASSES[s.tone]?.dot)} />
      {s.label}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground", className)}>{children}</span>;
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-5 shadow-card", className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm">{children ?? "—"}</div>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className="w-10 text-right font-mono text-xs">{Math.round(value)}%</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-16 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Loading() {
  return <div className="space-y-2 p-2"><div className="h-10 animate-pulse rounded bg-muted" /><div className="h-36 animate-pulse rounded bg-muted" /></div>;
}

export function SearchBox({ value, onChange, placeholder = "Search" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="relative w-full max-w-sm"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>;
}

// Records keep their is_demo flag in the database; the label is hidden because the company treats these records as real.
export function DemoBadge() {
  return null;
}
