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

export function PermanentDelete({ kind,id,name,disabled=false }: {kind:DeletionKind;id:string;name:string;disabled?:boolean}) {
  const me=useMe();
  const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState("");
  const qc=useQueryClient(),run=useServerFn(permanentlyDeleteRecord);
  const mutation=useMutation({mutationFn:()=>run({data:{kind,id}}),onSuccess:()=>{
    setOpen(false);toast.success("Permanently deleted");
    for(const key of ["materials","prs","rfqs","users","pr-list-refs","material-refs","me"]) void qc.invalidateQueries({queryKey:[key]});
  },onError:(error)=>toast.error(error.message)});
  if(!me.data?.profile.is_active || !me.data.roles.includes("super_admin")) return null;
  return <>
    <Button variant="ghost" size="icon" className="text-destructive" disabled={disabled} aria-label={`Delete ${name}`} title={disabled?"Only unused drafts and non-admin staff accounts can be deleted":`Delete ${name}`} onClick={()=>{setConfirmation("");mutation.reset();setOpen(true);}}><Trash2 className="h-4 w-4"/></Button>
    <Dialog open={open} onOpenChange={(value)=>{if(!mutation.isPending)setOpen(value);}}>
      <DialogContent><DialogHeader><DialogTitle>Permanently delete {name}?</DialogTitle><DialogDescription>This cannot be undone. Records linked to purchases or history cannot be deleted.</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor={`delete-${id}`}>Type DELETE to confirm</Label><Input id={`delete-${id}`} autoComplete="off" value={confirmation} onChange={(event)=>setConfirmation(event.target.value)} disabled={mutation.isPending}/></div>
        {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
        <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={()=>setOpen(false)}>Cancel</Button><Button variant="destructive" disabled={confirmation!=="DELETE" || mutation.isPending} onClick={()=>mutation.mutate()}>{mutation.isPending?"Deleting…":"Delete permanently"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}