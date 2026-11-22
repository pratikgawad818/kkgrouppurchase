import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { canPermanentlyDeleteUnusedGrn } from "@/lib/grn-delete-eligibility";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// New secured RPC pending regeneration of the Supabase client type snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function DeleteUnusedGrnButton({
  id, number, status, postedAt, onDeleted,
}: {
  id: string;
  number: string;
  status: string;
  postedAt: string | null;
  onDeleted?: () => void;
}) {
  const me=useMe();
  const qc=useQueryClient();
  const [open,setOpen]=useState(false);
  const [confirmation,setConfirmation]=useState("");
  const [reason,setReason]=useState("");
  const allowed=canPermanentlyDeleteUnusedGrn(
    me.data?.roles??[],!!me.data?.profile.is_active,status,postedAt);

  const deleting=useMutation({
    mutationFn: async()=>{
      if(!allowed)throw new Error("This GRN cannot be permanently deleted.");
      if(confirmation!=="DELETE")throw new Error("Type DELETE to confirm.");
      const why=reason.trim();
      if(why.length<3||why.length>500)throw new Error("Enter a deletion reason (3–500 characters).");
      const {error}=await db.rpc("super_admin_delete_unused_grn",{
        _grn_id:id,_reason:why,
      });
      if(error)throw error;
    },
    onSuccess:async()=>{
      setOpen(false);setConfirmation("");setReason("");
      toast.success("Unused GRN deleted; audit snapshot retained.");
      await Promise.all([
        qc.invalidateQueries({queryKey:["grns"]}),
        qc.invalidateQueries({queryKey:["grn",id]}),
        qc.invalidateQueries({queryKey:["pos"]}),
        qc.invalidateQueries({queryKey:["po"]}),
      ]);
      onDeleted?.();
    },
    onError:e=>toast.error(errMsg(e)),
  });
  if(!allowed)return null;
  return <>
    <Button type="button" size="sm" variant="outline"
      className="min-h-10 gap-1.5 text-destructive hover:text-destructive"
      aria-label={`Delete unused GRN ${number}`}
      onClick={event=>{
        event.stopPropagation();setConfirmation("");setReason("");deleting.reset();setOpen(true);
      }}>
      <Trash2 aria-hidden="true" className="h-4 w-4"/>Delete GRN
    </Button>
    <Dialog open={open} onOpenChange={v=>{if(!deleting.isPending)setOpen(v);}}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delete {number} permanently?</DialogTitle>
          <DialogDescription>
            This {status} GRN was never posted to stock. Its unused draft lines
            will be deleted, but a complete deletion snapshot remains in the
            audit history. This action cannot be undone. Posted GRNs cannot be
            deleted here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`delete-grn-reason-${id}`}>Reason for deletion *</label>
            <Textarea id={`delete-grn-reason-${id}`} rows={3} maxLength={500}
              value={reason} onChange={e=>setReason(e.target.value)}
              placeholder="e.g. Duplicate unused GRN, entered by mistake"/>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`delete-grn-confirm-${id}`}>Type DELETE to confirm *</label>
            <Input id={`delete-grn-confirm-${id}`} autoComplete="off"
              value={confirmation} onChange={e=>setConfirmation(e.target.value)}
              placeholder="DELETE"/>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" disabled={deleting.isPending}
            onClick={()=>setOpen(false)}>Keep GRN</Button>
          <Button variant="destructive" type="button"
            disabled={deleting.isPending||confirmation!=="DELETE"||
              reason.trim().length<3||reason.trim().length>500}
            onClick={()=>deleting.mutate()}>
            {deleting.isPending?"Deleting…":"Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
