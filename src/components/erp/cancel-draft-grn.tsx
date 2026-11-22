import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { errMsg } from "@/lib/format";
import { canCancelDraftGrn } from "@/lib/grn-draft-cancellation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The new RPC is deployed separately from the generated Supabase type snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const draftGrnDb = supabase as any;

export function CancelDraftGrnButton({
  id, number, status, receivedBy, onCancelled,
}: {
  id: string;
  number: string;
  status: string;
  receivedBy: string | null;
  onCancelled?: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const authorized = canCancelDraftGrn({
    status,
    receivedBy,
    viewerId: me.data?.profile.id,
    roles: me.data?.roles ?? [],
    canCreate: !!me.data?.permissions.has("grn.create"),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!authorized) throw new Error("You cannot cancel this goods receipt draft.");
      const comment = reason.trim();
      if (comment.length < 3 || comment.length > 500)
        throw new Error("Enter a cancellation reason (3–500 characters).");
      const { error } = await draftGrnDb.rpc("cancel_draft_goods_receipt", {
        _grn_id: id,
        _reason: comment,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("GRN draft cancelled. No stock was changed.");
      setOpen(false);
      setReason("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["grns"] }),
        qc.invalidateQueries({ queryKey: ["grn", id] }),
        qc.invalidateQueries({ queryKey: ["pos"] }),
        qc.invalidateQueries({ queryKey: ["po"] }),
        qc.invalidateQueries({ queryKey: ["stock"] }),
        qc.invalidateQueries({ queryKey: ["stock-ledger"] }),
      ]);
      onCancelled?.();
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  if (!authorized) return null;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-10 whitespace-nowrap text-destructive hover:text-destructive"
        aria-label={`Cancel draft ${number}`}
        onClick={() => { setReason(""); setOpen(true); }}
      >
        Cancel draft
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!cancel.isPending) setOpen(next); }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel draft {number}?</DialogTitle>
            <DialogDescription>
              This draft has not been posted to stock. Cancelling it keeps the GRN
              and its history for audit, but excludes its quantities from future
              challan receiving. Posted GRNs cannot be cancelled here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor={`cancel-draft-grn-reason-${id}`} className="text-sm font-medium">
              Cancellation reason *
            </label>
            <Textarea
              id={`cancel-draft-grn-reason-${id}`}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Wrong quantity recorded, duplicate draft"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">Required · 3–500 characters</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={cancel.isPending}
              onClick={() => setOpen(false)}>Keep draft</Button>
            <Button type="button" variant="destructive"
              disabled={cancel.isPending || reason.trim().length < 3 || reason.trim().length > 500}
              onClick={() => cancel.mutate()}>
              {cancel.isPending ? "Cancelling…" : "Confirm cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
