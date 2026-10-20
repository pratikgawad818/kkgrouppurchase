import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMe } from "@/lib/session";
import { permanentlyDeleteRecord } from "@/lib/deletion.functions";
import type { DeletionKind } from "@/lib/deletion-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function PermanentDelete({ kind,id,name,disabled=false,onDeleted }: {kind:DeletionKind;id:string;name:string;disabled?:boolean;onDeleted?:()=>void}) {
  const me=useMe();
  const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState("");
  const qc=useQueryClient(),run=useServerFn(permanentlyDeleteRecord);
  const mutation=useMutation({mutationFn:()=>run({data:{kind,id}}),onSuccess:()=>{
    setOpen(false);toast.success("Permanently deleted");onDeleted?.();
    void qc.invalidateQueries();
  },onError:(error)=>toast.error(error.message)});
  if(!me.data?.profile.is_active || !me.data.roles.includes("super_admin")) return null;
  return <>
    <Button variant="ghost" size="icon" className="text-destructive" disabled={disabled} aria-label={`Delete ${name}`} title={disabled?"Your own account and Super Admin accounts cannot be deleted":`Delete ${name}`} onClick={(e)=>{e.stopPropagation();e.preventDefault();setConfirmation("");mutation.reset();setOpen(true);}}><Trash2 className="h-4 w-4"/></Button>
    <Dialog open={open} onOpenChange={(value)=>{if(!mutation.isPending)setOpen(value);}}>
      <DialogContent onClick={(e)=>e.stopPropagation()}><DialogHeader><DialogTitle>Permanently delete {name}?</DialogTitle><DialogDescription>{kind==="user"?"This cannot be undone.":"This cannot be undone. Everything created from it (for example quotations, orders, receipts, invoices, payments and their stock or account entries) will also be deleted, and stock balances will be corrected."}</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor={`delete-${id}`}>Type DELETE to confirm</Label><Input id={`delete-${id}`} autoComplete="off" value={confirmation} onChange={(event)=>setConfirmation(event.target.value)} disabled={mutation.isPending}/></div>
        {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
        <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={()=>setOpen(false)}>Cancel</Button><Button variant="destructive" disabled={confirmation!=="DELETE" || mutation.isPending} onClick={()=>mutation.mutate()}>{mutation.isPending?"Deleting…":"Delete permanently"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}