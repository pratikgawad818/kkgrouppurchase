import { useMutation } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { errMsg } from "@/lib/format";

type ApprovalKind = "purchase_order" | "vendor_payment";

/** Reminder only: the database independently enforces recipient scope and permissions. */
export function DirectorApprovalReminder({
  id,
  kind,
  disabled = false,
}: {
  id: string;
  kind: ApprovalKind;
  disabled?: boolean;
}) {
  const reminder = useMutation({
    mutationFn: async () => {
      const result =
        kind === "purchase_order"
          ? await supabase.rpc("remind_po_approvers", { _po_id: id })
          : await supabase.rpc("remind_payment_approvers" as never, {
              _payment_id: id,
            } as never);
      if (result.error) throw result.error;
    },
    onSuccess: () => toast.success("In-app reminder sent to eligible directors"),
    onError: (error) => toast.error("Could not send reminder", { description: errMsg(error) }),
  });

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="min-h-10 gap-2"
      disabled={disabled || reminder.isPending}
      onClick={() => reminder.mutate()}
      aria-label="Remind directors to review this pending approval"
    >
      <BellRing className="h-4 w-4" aria-hidden="true" />
      {reminder.isPending ? "Sending reminder…" : "Remind Directors"}
    </Button>
  );
}
