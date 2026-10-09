import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle2, CircleDot } from "lucide-react";

import { setupCompletion, setupSteps, type SetupCounts } from "@/lib/erp-onboarding";
import { cn } from "@/lib/utils";

export function FirstRunSetup({
  counts,
  can,
}: {
  counts: SetupCounts;
  can: (permission: string) => boolean;
}) {
  const progress = setupCompletion(counts);
  if (progress.ready) return null;

  return (
    <section className="mb-7 overflow-hidden rounded-2xl border bg-card shadow-card" aria-labelledby="getting-started-heading">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b bg-muted/20 px-4 py-5 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            First-time workspace setup
          </p>
          <h2 id="getting-started-heading" className="mt-1 text-lg font-semibold tracking-tight">
            Prepare KK GROUP for purchasing
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your workspace is ready for genuine project data. Complete the master setup below
            before raising purchase requests or receiving construction materials.
          </p>
        </div>
        <div className="shrink-0 rounded-xl border bg-background px-4 py-3 text-center">
          <div className="text-xl font-semibold tabular-nums">{progress.completed} / {progress.total}</div>
          <div className="text-[11px] text-muted-foreground">steps complete</div>
        </div>
      </header>

      <div className="px-4 py-5 sm:px-6">
        <div
          className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="ERP setup progress"
          aria-valuenow={progress.completed}
          aria-valuemin={0}
          aria-valuemax={progress.total}
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.completed / progress.total * 100}%` }} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {setupSteps(counts).map((step, index) => {
            const allowed = can(step.permission);
            const content = (
              <>
                <div className="flex items-center gap-2">
                  {step.completed
                    ? <CheckCircle2 aria-hidden className="h-4 w-4 text-primary" />
                    : <CircleDot aria-hidden className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-xs font-semibold text-muted-foreground">Step {index + 1}</span>
                  {allowed && !step.completed && <ArrowUpRight aria-hidden className="ml-auto h-4 w-4 text-primary" />}
                </div>
                <h3 className="mt-3 text-sm font-semibold">{step.label}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                <p className="mt-3 text-xs font-semibold text-primary">
                  {step.completed ? "Configured" : allowed ? "Open setup →" : "Requires a manager"}
                </p>
              </>
            );
            const cls = cn(
              "block min-h-36 rounded-xl border p-4 transition-[border-color,box-shadow]",
              step.completed ? "bg-muted/25" : "bg-background",
              allowed && !step.completed && "hover:border-primary/50 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
            );
            return allowed
              ? <Link key={step.key} to={step.to} className={cls}>{content}</Link>
              : <div key={step.key} className={cls}>{content}</div>;
          })}
        </div>
        <p className="mt-5 text-xs text-muted-foreground">
          Purchase-order and vendor-payment approvals require three separately authorised director accounts.
          Configure these when the directors' individual logins are ready; no placeholder approvers are created.
        </p>
      </div>
    </section>
  );
}
