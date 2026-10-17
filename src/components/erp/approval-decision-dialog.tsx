import { useRef } from "react";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { inr } from "@/lib/format";

export type ApprovalDecisionTarget = {
  number: string;
  amount: number;
  project: string;
  vendor: string;
  kind: "purchase_order" | "vendor_payment";
};

export function ApprovalDecisionDialog({
  target,
  open = !!target,
  decision,
  comment,
  onComment,
  onConfirm,
  onClose,
  onReturnFocus,
  busy,
  error,
}: {
  target: ApprovalDecisionTarget | null;
  open?: boolean;
  decision: "approved" | "rejected";
  comment: string;
  onComment: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  onReturnFocus?: () => void;
  busy: boolean;
  error?: string | undefined;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const reject = decision === "rejected";
  const disabled = busy || (reject && !comment.trim());
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="approval-decision-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (onReturnFocus) {
            event.preventDefault();
            onReturnFocus();
          }
        }}
      >
        <DialogHeader>
          <span
            className={`approval-dialog-icon ${reject ? "is-rejection" : ""}`}
            aria-hidden="true"
          >
            {reject ? <XCircle /> : <CheckCircle2 />}
          </span>
          <DialogTitle ref={heading} tabIndex={-1} className="outline-none">
            {reject
              ? "Reject this order?"
              : target?.kind === "vendor_payment"
                ? "Approve this payment?"
                : "Approve this order?"}
          </DialogTitle>
          <DialogDescription>Check the details before confirming your decision.</DialogDescription>
        </DialogHeader>
        {target && (
          <div className="approval-dialog-summary">
            <p className="text-xs font-semibold text-muted-foreground">{target.number}</p>
            <p className="num mt-1 text-3xl font-semibold tracking-tight">{inr(target.amount)}</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Supplier</dt>
                <dd className="mt-0.5 break-words font-medium">{target.vendor}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Project</dt>
                <dd className="mt-0.5 break-words font-medium">{target.project}</dd>
              </div>
            </dl>
          </div>
        )}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled) onConfirm();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="director-decision-comment">
              {reject ? "Reason for rejection" : "Comment (optional)"}
            </Label>
            <Textarea
              id="director-decision-comment"
              required={reject}
              rows={3}
              maxLength={2000}
              value={comment}
              onChange={(event) => onComment(event.target.value)}
              aria-describedby="director-decision-help"
              placeholder={
                reject ? "Explain what needs to change…" : "Add a note to the approval history…"
              }
            />
            <p id="director-decision-help" className="text-xs text-muted-foreground">
              {reject
                ? "A reason is required so the team can correct the order."
                : "Your name and decision time are saved automatically."}
            </p>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="grid grid-cols-2 sm:flex">
            <Button
              type="button"
              variant="outline"
              className="approval-action min-h-12"
              disabled={busy}
              onClick={onClose}
            >
              Go back
            </Button>
            <Button
              type="submit"
              className="approval-action min-h-12"
              variant={reject ? "destructive" : "default"}
              disabled={disabled}
            >
              {busy ? "Saving…" : reject ? "Reject" : "Approve"}
            </Button>
          </DialogFooter>
        </form>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Recorded securely in the approval history.
        </p>
      </DialogContent>
    </Dialog>
  );
}
