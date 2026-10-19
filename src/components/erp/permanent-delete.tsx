import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMe } from "@/lib/session";
import { checkPermanentDeletion, permanentlyDeleteRecord } from "@/lib/deletion.functions";
import type { DeletionKind } from "@/lib/deletion-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PermanentDelete({
  kind,
  id,
  name,
  disabled = false,
  labelled = false,
}: {
  kind: DeletionKind;
  id: string;
  name: string;
  disabled?: boolean;
  labelled?: boolean;
}) {
  const me = useMe();
  const [open, setOpen] = useState(false),
    [confirmation, setConfirmation] = useState("");
  const qc = useQueryClient(),
    run = useServerFn(permanentlyDeleteRecord),
    check = useServerFn(checkPermanentDeletion);
  const eligibility = useQuery({
    queryKey: ["deletion-check", kind, id],
    enabled: open,
    staleTime: 0,
    retry: false,
    queryFn: () => check({ data: { kind, id } }),
  });
  const mutation = useMutation({
    mutationFn: () => run({ data: { kind, id } }),
    onSuccess: () => {
      setOpen(false);
      toast.success("Permanently deleted");
      void qc.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
  if (!me.data?.profile.is_active || !me.data.roles.includes("super_admin")) return null;
  return (
    <>
      <Button
        variant={labelled ? "outline" : "ghost"}
        size={labelled ? "sm" : "icon"}
        className="min-h-11 min-w-11 text-destructive"
        disabled={disabled}
        aria-label={`Delete ${name}`}
        title={
          disabled
            ? "This record must be cancelled or corrected with its history retained"
            : `Delete ${name}`
        }
        onClick={() => {
          setConfirmation("");
          mutation.reset();
          setOpen(true);
        }}
      >
        <Trash2 className="h-4 w-4" />
        {labelled && "Delete"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete {name}?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Linked purchases, stock, payments and history are protected. A
              deletion entry is retained in the audit log.
            </DialogDescription>
          </DialogHeader>
          {eligibility.isFetching ? (
            <p role="status" className="text-sm text-muted-foreground">
              Checking linked records…
            </p>
          ) : eligibility.error ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <p className="font-medium">This record cannot be deleted</p>
              <p className="mt-1">{eligibility.error.message}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`delete-${id}`}>Type DELETE to confirm</Label>
              <Input
                id={`delete-${id}`}
                autoComplete="off"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={mutation.isPending}
              />
            </div>
          )}
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                confirmation !== "DELETE" ||
                mutation.isPending ||
                eligibility.isFetching ||
                !eligibility.isSuccess
              }
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
