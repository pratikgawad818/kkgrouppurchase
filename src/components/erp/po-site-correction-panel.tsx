import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { fmtDateTime, errMsg } from "@/lib/format";
import { useMe } from "@/lib/session";

export type PoSiteCorrection = {
  id: string;
  po_id: string;
  purchase_request_id: string;
  assigned_to: string;
  requested_by: string;
  created_at: string;
  reason: string;
  status: "requested" | "responded" | "resolved";
  response: string | null;
  responded_at: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
};

export function PoSiteCorrectionPanel({
  poId, poNumber, status, corrections, onChanged,
}: {
  poId: string; poNumber: string; status: string;
  corrections: PoSiteCorrection[];
  onChanged: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const manager = !!me.data?.roles.some((role) => role === "purchase_manager" || role === "super_admin");
  const open = corrections.find((r) => r.status !== "resolved");
  const [mode, setMode] = useState<"request" | "resolve" | null>(null);
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < (mode === "request" ? 10 : 5))
        throw new Error("Explain the correction before continuing.");
      if (!mode) return;
      const { error } = mode === "request"
        ? await supabase.rpc("escalate_rejected_po_to_site" as never, {
            _po_id: poId, _reason: reason.trim(),
          } as never)
        : await supabase.rpc("resolve_po_site_correction" as never, {
            _correction_id: open?.id, _resolution: reason.trim(),
          } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      setMode(null);
      setReason("");
      toast.success("Site correction workflow updated");
      await qc.invalidateQueries({ queryKey: ["po-site-corrections", poId] });
      await qc.invalidateQueries({ queryKey: ["pr-site-corrections"] });
      onChanged();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!corrections.length && !(status === "rejected" && manager)) return null;
  return (
    <section className="mt-4 rounded-xl border bg-card p-4 shadow-sm" aria-label="Site Engineer correction requests">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Site Engineer correction handoff</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            If the mistake originates in the site request, return the issue to the Site
            Engineer who raised the PR. Approved source PRs and supplier quotations
            remain unchanged until the Purchase Manager reconciles them.
          </p>
        </div>
        {manager && status === "rejected" && !open && (
          <Button size="sm" variant="outline" onClick={() => { setReason(""); setMode("request"); }}>
            <RotateCcw className="mr-1 h-4 w-4"/>Revert to Site Engineer
          </Button>
        )}
      </div>
      {!!open && (
        <div role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          {open.status === "requested"
            ? "Waiting for the Site Engineer's correction response. PO resubmission is blocked."
            : "Site Engineer has replied. Purchase Manager must review, correct the PO and resolve this handoff before resubmission."}
        </div>
      )}
      <ol className="mt-3 space-y-3">
        {corrections.map((record) => (
          <li key={record.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-semibold">{record.status === "requested"
                ? "Awaiting Site Engineer"
                : record.status === "responded" ? "Awaiting Purchase Manager review" : "Resolved"}</span>
              <time dateTime={record.created_at} className="text-xs text-muted-foreground">
                {fmtDateTime(record.created_at)}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{record.reason}</p>
            {record.response && (
              <div className="mt-2 rounded-md bg-muted/40 p-3">
                <p className="text-xs font-semibold">Site Engineer's response · {record.responded_at ? fmtDateTime(record.responded_at) : ""}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{record.response}</p>
              </div>
            )}
            {record.resolution_note && (
              <p className="mt-2 flex items-start gap-2 text-xs">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary"/>
                Resolved: {record.resolution_note}
              </p>
            )}
            {manager && status === "rejected" && record.status === "responded" && (
              <Button size="sm" className="mt-3" variant="outline"
                onClick={() => { setReason(""); setMode("resolve"); }}>
                Confirm correction reviewed
              </Button>
            )}
          </li>
        ))}
      </ol>
      <Dialog open={mode !== null} onOpenChange={(next) => { if (!next && !mutation.isPending) setMode(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "request" ? "Return issue to original Site Engineer?" : "Resolve Site Engineer correction?"}
            </DialogTitle>
            <DialogDescription>
              {mode === "request"
                ? `The Site Engineer will be notified about ${poNumber} via the original PR. A written response is mandatory before this PO may be resubmitted.`
                : "Confirm the engineer's findings have been reviewed and any required PO changes have been saved. The existing PO number remains unchanged."}
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm font-medium" htmlFor="po-site-correction-reason">
            {mode === "request" ? "What must the Site Engineer correct? *" : "How was this issue resolved? *"}
          </label>
          <Textarea id="po-site-correction-reason" rows={4} maxLength={2000}
            placeholder={mode === "request" ? "Describe the incorrect site quantity, specification or requirement…" : "Explain the verified resolution and any PO revisions made…"}
            value={reason} onChange={e => setReason(e.target.value)} />
          {mutation.error && <p role="alert" className="text-sm text-destructive">{errMsg(mutation.error)}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={mutation.isPending}>Go back</Button>
            <Button disabled={mutation.isPending || reason.trim().length < (mode === "request" ? 10 : 5)}
              onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Saving…" : mode === "request" ? "Send to Site Engineer" : "Confirm reviewed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
