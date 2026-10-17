import { useRef } from "react";
import type { ApprovalKind } from "@/lib/approval-queue";
import { cn } from "@/lib/utils";

const tabs = [
  { kind: "purchase_order", label: "Purchase Orders", shortLabel: "Orders" },
  { kind: "vendor_payment", label: "Vendor Payments", shortLabel: "Payments" },
] as const;

export function ApprovalKindTabs({
  value,
  counts,
  onChange,
}: {
  value: ApprovalKind;
  counts: Record<ApprovalKind, number> | undefined;
  onChange: (kind: ApprovalKind) => void;
}) {
  const buttons = useRef<Partial<Record<ApprovalKind, HTMLButtonElement | null>>>({});
  return (
    <div
      role="tablist"
      aria-label="Approval type"
      className="mb-5 grid grid-cols-2 gap-1 rounded-full border bg-muted p-1"
    >
      {tabs.map(({ kind, label, shortLabel }, index) => (
        <button
          key={kind}
          ref={(button) => {
            buttons.current[kind] = button;
          }}
          type="button"
          role="tab"
          id={`approval-tab-${kind}`}
          aria-label={counts ? `${label}, ${counts[kind]}` : label}
          aria-selected={value === kind}
          aria-controls="approval-queue-panel"
          tabIndex={value === kind ? 0 : -1}
          onClick={() => onChange(kind)}
          onKeyDown={(event) => {
            const next =
              event.key === "Home"
                ? tabs[0]
                : event.key === "End"
                  ? tabs[1]
                  : event.key === "ArrowLeft" || event.key === "ArrowRight"
                    ? tabs[1 - index]
                    : null;
            if (!next) return;
            event.preventDefault();
            buttons.current[next.kind]?.focus();
            onChange(next.kind);
          }}
          className={cn(
            "flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:text-sm",
            value === kind
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
          )}
        >
          <span className="sm:hidden">{shortLabel}</span>
          <span className="hidden sm:inline">{label}</span>
          {counts && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums sm:text-xs",
                value === kind ? "bg-primary-foreground/20" : "bg-background text-foreground",
              )}
            >
              {counts[kind]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
