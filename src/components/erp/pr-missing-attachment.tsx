import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ProcurementAttachmentInput } from "@/components/erp/procurement-attachment";
import { uploadProcurementAttachment } from "@/lib/procurement-attachments";
import { errMsg } from "@/lib/format";

/** Repair an existing pending PR whose original supporting file did not link. */
export function PrMissingAttachment({
  prId,
  companyId,
  actorId,
  onLinked,
}: {
  prId: string;
  companyId: string;
  actorId: string;
  onLinked: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const uploaded = useRef<{ file: File; path: string } | null>(null);

  async function attach() {
    if (!file || busy) return;
    setBusy(true);
    try {
      const path = uploaded.current?.file === file
        ? uploaded.current.path
        : await uploadProcurementAttachment(file, companyId, actorId);
      uploaded.current = { file, path };
      const { error } = await supabase.rpc("set_purchase_request_attachment", {
        _id: prId,
        _path: path,
      });
      if (error) throw error;
      toast.success("Document attached to the existing purchase request");
      uploaded.current = null;
      setFile(null);
      onLinked();
    } catch (error) {
      toast.error("Could not attach to this request", {
        description: errMsg(error) + ". Keep this request; do not submit a duplicate.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 space-y-3 rounded-xl border border-amber-500/30 bg-card p-4"
      aria-label="Attach missing purchase request document">
      <div>
        <h2 className="text-sm font-semibold">Attach missing supporting document</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This request is already submitted for approval, but has no attachment.
          Add the first PDF or photo here to this same request. You cannot
          replace the attachment or change the request after approval.
        </p>
      </div>
      <ProcurementAttachmentInput
        file={file}
        setFile={(next) => { if (!busy) { setFile(next); uploaded.current = null; } }}
        label="Original quotation / site supporting PDF or photo"
      />
      <Button type="button" disabled={!file || busy || !companyId || !actorId}
        onClick={() => void attach()}>
        {busy ? "Attaching…" : "Attach to this request"}
      </Button>
    </section>
  );
}
