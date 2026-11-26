import { fmtDate } from "@/lib/format";
import { PR_NOTICE_DAYS } from "@/lib/pr-notice";
export function PrNoticeCard({days, submittedOn, requiredBy, reason, preview=false}:{days:number;submittedOn:string;requiredBy:string;reason?:string|null;preview?:boolean}) {
  const late=days<PR_NOTICE_DAYS;
  return <section className="rounded-xl border bg-card p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Purchase planning · {preview?"If submitted today":"First submission"}</h2>
      <span className={"rounded-full px-2.5 py-1 text-xs font-semibold "+(late?"bg-red-500/10 text-red-700 dark:text-red-400":"bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")}>{late?"Late purchase request":"Planned"}</span>
    </div>
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div><p className="text-xs text-muted-foreground">PR submission date</p>{fmtDate(submittedOn)}</div>
      <div><p className="text-xs text-muted-foreground">Earliest material required by</p>{fmtDate(requiredBy)}</div>
    </div>
    <div className="grid grid-cols-3 gap-2 border-t pt-3">
      <div><p className="text-xs text-muted-foreground">Required notice</p><p className="text-lg font-bold">7 days</p></div>
      <div><p className="text-xs text-muted-foreground">Actual notice</p><p className="text-lg font-bold">{days} {Math.abs(days)===1?"day":"days"}</p></div>
      <div><p className="text-xs text-muted-foreground">Planning shortfall</p><p className={"text-lg font-bold "+(late?"text-destructive":"")}>{Math.max(0,7-days)} days</p></div>
    </div>
    {reason&&<div className="border-t pt-2 text-sm break-words"><p className="text-xs text-muted-foreground">Reason for short notice</p>{reason}</div>}
    {preview&&late&&<p className="text-xs text-muted-foreground">Short-notice requests may be submitted only with a genuine reason. Normal procurement approvals still apply.</p>}
  </section>;
}
