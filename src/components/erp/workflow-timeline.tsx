import {
  ArrowRight, Check, CheckCircle2, Clock3, FileClock,
  RotateCcw, ShieldCheck, UserRound, X,
} from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import {
  chronologicalWorkflowEvents,
  workflowEventTitle,
  workflowEventTone,
  workflowPresentation,
  type WorkflowEvent,
  type WorkflowKind,
  type WorkflowStage,
} from "@/lib/workflow-progress";

function Stage({ stage, index }: { stage: WorkflowStage; index: number }) {
  const done = stage.state === "complete";
  const active = stage.state === "current";
  const stopped = stage.state === "stopped";
  return (
    <li className={
      "flex min-w-0 items-start gap-2 rounded-lg border p-3 " +
      (active
        ? "border-primary/40 bg-primary/5"
        : stopped ? "border-destructive/30 bg-destructive/5"
          : "border-border/70 bg-background")
    }>
      <span
        aria-hidden="true"
        className={
          "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold " +
          (done ? "border-primary bg-primary text-primary-foreground"
            : active ? "border-primary text-primary"
              : stopped ? "border-destructive text-destructive"
                : "border-border text-muted-foreground")
        }
      >
        {done ? <Check className="h-3.5 w-3.5" />
          : stopped ? <X className="h-3.5 w-3.5" />
            : active ? <Clock3 className="h-3.5 w-3.5" /> : index + 1}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={"break-words text-xs font-semibold leading-5 " +
          (active ? "text-foreground" : stopped ? "text-destructive"
            : done ? "text-foreground" : "text-muted-foreground")}>
          {stage.label}
        </p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          {done ? "Completed" : active ? "Current stage"
            : stopped ? "Stopped" : "Upcoming"}
        </p>
      </div>
    </li>
  );
}

export function WorkflowTimeline({
  kind, status, events, rfqStatuses,
}: {
  kind: WorkflowKind;
  status: string;
  events: readonly WorkflowEvent[];
  rfqStatuses?: readonly string[] | undefined;
}) {
  const sorted = chronologicalWorkflowEvents(events);
  const lastAction = sorted.at(-1)?.action;
  const summary = workflowPresentation(kind, status, rfqStatuses, lastAction);

  return (
    <section
      className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm"
      aria-label="Approval history and workflow progress"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border bg-muted/30 text-foreground">
            <FileClock className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">
              Approval history &amp; progress
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Verified actions, their timestamps and the next responsible team
            </p>
          </div>
        </div>
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium">
          {summary.finished
            ? summary.blocked
              ? <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            : summary.blocked
              ? <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              : <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="break-words">{summary.stateLabel}</span>
        </span>
      </header>

      <div className="p-4 sm:p-6">
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5" aria-label="Workflow stages">
          {summary.stages.map((stage, index) => (
            <Stage key={stage.key} stage={stage} index={index} />
          ))}
        </ol>

        <section
          className="mt-5 rounded-xl border border-primary/20 bg-primary/[0.035] p-4"
          aria-label={summary.finished ? "Workflow outcome" : "Next required action"}
        >
          {summary.nextTitle ? (
            <>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ArrowRight className="h-4 w-4 text-primary" aria-hidden="true" />
                Next action
              </div>
              <h3 className="mt-2 text-sm font-semibold leading-6 sm:text-base">
                {summary.nextTitle}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {summary.nextDescription}
              </p>
              {summary.nextOwner && (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <UserRound className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="font-medium">Responsible role:</span>
                  <span className="break-words text-foreground">{summary.nextOwner}</span>
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Workflow outcome
              </div>
              <h3 className="mt-2 text-sm font-semibold">{summary.stateLabel}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {summary.nextDescription}
              </p>
            </>
          )}
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
          <h3 className="text-sm font-semibold">Recorded activity</h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {sorted.length} {sorted.length === 1 ? "event" : "events"}
          </span>
        </div>
        {sorted.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">
            No approval actions have been recorded yet.
          </p>
        ) : (
          <ol className="ml-3 border-l border-border/80" aria-label="Chronological audit history">
            {sorted.map((event) => {
              const tone = workflowEventTone(event);
              return (
                <li key={event.id} className="relative py-4 pl-6 last:pb-1">
                  <span
                    className={
                      "absolute -left-[12px] top-[20px] grid h-6 w-6 place-items-center rounded-full border-2 border-background " +
                      (tone === "success"
                        ? "bg-emerald-600 text-white"
                        : tone === "warning"
                          ? "bg-amber-600 text-white"
                          : "bg-muted text-foreground")
                    }
                    aria-hidden="true"
                  >
                    {tone === "success" ? <Check className="h-3.5 w-3.5" />
                      : tone === "warning" ? <RotateCcw className="h-3.5 w-3.5" />
                        : <Clock3 className="h-3.5 w-3.5" />}
                  </span>
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <p className="min-w-0 text-sm font-semibold leading-relaxed">
                      {workflowEventTitle(kind, event)}
                    </p>
                    <time dateTime={event.occurredAt}
                      className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtDateTime(event.occurredAt)}
                    </time>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    By {event.actorName || "Staff name unavailable"}
                  </p>
                  {event.reference && (
                    event.referencePath ? (
                      <a className="mt-1 block w-fit break-all text-xs font-medium text-primary underline-offset-2 hover:underline"
                        href={event.referencePath}>
                        {event.reference}
                      </a>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">{event.reference}</p>
                    )
                  )}
                  {event.comment && (
                    <blockquote className="mt-2 whitespace-pre-wrap break-words rounded-lg border-l-2 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground">
                      {event.comment}
                    </blockquote>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-5 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
          Names and times above come from recorded actions. The next responsible role
          is based on the document status—not a personal assignment or notification.
        </p>
      </div>
    </section>
  );
}
