import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PROCUREMENT_ATTACHMENT_ACCEPT, uploadProcurementAttachment } from "@/lib/procurement-attachments";
import { errMsg } from "@/lib/format";

/** Fills a missing supplier quotation file on an existing PO. Never replaces an existing file. */
export function AttachPoQuotation({
  poId, companyId, userId, onDone,
}: { poId: string; companyId: string; userId: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const path = await uploadProcurementAttachment(file, companyId, userId);
      const { error } = await supabase.rpc("attach_missing_po_quotation", { _po_id: poId, _path: path });
      if (error) throw error;
      toast.success("Quotation attached");
      onDone();
    } catch (error) {
      toast.error("Could not attach the quotation", { description: errMsg(error) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input ref={input} type="file" accept={PROCUREMENT_ATTACHMENT_ACCEPT} className="sr-only"
        aria-label="Quotation file" tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <Button type="button" size="sm" variant="outline" className="min-h-10" disabled={busy}
        onClick={() => input.current?.click()}>
        <Paperclip className="mr-1 h-4 w-4" />
        {busy ? "Uploading…" : "Attach quotation"}
      </Button>
    </>
  );
}
