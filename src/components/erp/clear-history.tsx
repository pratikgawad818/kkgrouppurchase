import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { errMsg } from "@/lib/format";

type Scope = "approvals" | "audit" | "audit_row";

export function ClearHistory({ scope, auditId, label }: { scope: Scope; auditId?: number; label: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!me.data?.roles.includes("super_admin")) return null;
  const run = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("super_admin_clear_history", { _scope: scope, _audit_id: auditId });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(`Deleted ${data ?? 0} record(s)`);
    setOpen(false); setText("");
    void qc.invalidateQueries();
  };
  const row = scope === "audit_row";
  return <>
    <Button type="button" variant={row ? "ghost" : "outline"} size={row ? "icon" : "sm"} aria-label={label} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>
      <Trash2 className="h-4 w-4" />{!row && <span>{label}</span>}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>This permanently removes the history. It cannot be undone. Type DELETE to confirm.</DialogDescription>
        </DialogHeader>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={text !== "DELETE" || busy} onClick={run}>{busy ? "Deleting…" : "Delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
