import { useEffect, useState } from "react";
import { ExternalLink, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supplierChatDraftUrl } from "@/lib/supplier-whatsapp-drafts";

type Props = {
  label: string;
  supplier: string;
  mobile: string | null | undefined;
  draft: string;
};

export function SupplierWhatsAppDraftButton({ label, supplier, mobile, draft }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(draft);
  const [checked, setChecked] = useState(false);
  useEffect(() => { if (!open) { setMessage(draft); setChecked(false); } }, [draft, open]);
  const url = supplierChatDraftUrl(mobile, message);

  return <>
    <Button size="sm" variant="outline" disabled={!supplierChatDraftUrl(mobile, draft)}
      title={!supplierChatDraftUrl(mobile, draft) ? "Enter a valid supplier WhatsApp number in the vendor master." : undefined}
      onClick={() => { setMessage(draft); setChecked(false); setOpen(true); }}>
      <MessageCircle className="mr-1 h-4 w-4" />{label}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Review WhatsApp draft</DialogTitle>
          <DialogDescription>
            Opens WhatsApp for manual review. It will not send automatically or update any ERP document status.
          </DialogDescription>
        </DialogHeader>
        <dl className="rounded-lg border bg-muted/30 p-3 text-sm">
          <dt className="text-xs text-muted-foreground">Supplier</dt><dd className="font-medium">{supplier}</dd>
          <dt className="mt-2 text-xs text-muted-foreground">Vendor master contact (verify before opening)</dt>
          <dd className="font-mono">{mobile || "Missing mobile number"}</dd>
        </dl>
        <label className="block text-sm font-medium" htmlFor="kk-supplier-wa-draft">Editable message preview</label>
        <Textarea id="kk-supplier-wa-draft" rows={11} maxLength={3200} value={message}
          onChange={e => { setMessage(e.target.value); setChecked(false); }}
          className="min-h-[200px] resize-y whitespace-pre-wrap text-sm" />
        <p className="text-xs text-muted-foreground">
          Do not paste credentials, vendor bank details or private approval links. Attach actual RFQ/PO PDFs manually if required.
          Opening a chat is not proof a message was sent or received.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
            className="mt-1 h-4 w-4" />
          I checked the supplier number, document status and final wording.
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button asChild disabled={!checked || !url}>
            {checked && url
              ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                  Open WhatsApp draft <ExternalLink className="ml-1 h-4 w-4" />
                </a>
              : <span aria-disabled="true">Open WhatsApp draft</span>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
