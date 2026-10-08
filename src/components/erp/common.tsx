import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, UNIT_STATUS, type UnitStatus } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export function PageHeader({ title, subtitle, actions, crumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {crumbs && <div className="mb-1.5 text-xs font-medium text-muted-foreground">{crumbs}</div>}
        <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-[22px]">{title}</h2>
        {subtitle && <div className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 [&>*]:max-sm:min-h-11 [&>select]:max-sm:flex-1">{actions}</div>}
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
    <div className={cn("h-full rounded-xl border bg-card p-4 shadow-card transition-[border-color,box-shadow] md:p-5", className)}>
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div className="num mt-1.5 text-xl font-semibold text-foreground md:text-2xl">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
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
  return <div className="rounded-xl border border-dashed bg-muted/40 px-6 py-14 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-3 p-1">
      <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
      <div className="h-56 animate-pulse rounded-xl bg-muted" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="relative w-full sm:max-w-sm"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={placeholder} className="pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>;
}

// Records keep their is_demo flag in the database; the label is hidden because the company treats these records as real.
export function DemoBadge() {
  return null;
}
