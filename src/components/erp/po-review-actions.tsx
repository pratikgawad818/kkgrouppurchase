import { useState } from "react";
import { Eye, FileText, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { beginDocumentPreview, showDocument } from "@/components/erp/document-viewer";
import { buildPoReviewDocument } from "@/lib/po-pdf";
import { procurementAttachmentContentType, PROCUREMENT_ATTACHMENT_BUCKET } from "@/lib/procurement-attachments";
import { errMsg } from "@/lib/format";

/** Fetch the actual PO and its items when requested, not the full approval queue. */
export async function fetchPoReviewPdf(poId: string) {
  const [order, lines] = await Promise.all([
    supabase.from("purchase_orders")
      .select("*, vendors(company_name,gstin,pan,address,city,state,pincode,contact_person,mobile,email,bank_account_name,bank_name,bank_account_number,ifsc), projects(name), buildings(name), rfqs(rfq_number), purchase_requests(pr_number), warehouses(name,address), vendor_quotations(quotation_number,quotation_date,payment_terms,remarks), companies(name,legal_name,registered_address,office_address,gstin,pan,phone,email)")
      .eq("id", poId).single(),
    supabase.from("purchase_order_items")
      .select("line_no,description,ordered_quantity,rate,discount_amount,taxable_amount,tax_type,tax_rate_percent,tax_amount,line_total,items(code,name),units_of_measure(code)")
      .eq("po_id", poId).order("line_no"),
  ]);
  if (order.error) throw order.error;
  if (lines.error) throw lines.error;
  if (!lines.data?.length) throw new Error("This purchase order has no material lines to preview.");
  return buildPoReviewDocument(order.data, lines.data);
}

export function PoReviewActions({
  poId, poNumber, quotePath, size = "sm",
}: {
  poId: string;
  poNumber: string;
  quotePath?: string | null | undefined;
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = useState<"po" | "quotation" | null>(null);
  const [missingQuote, setMissingQuote] = useState(false);

  async function openPo() {
    if (busy) return;
    // Open the viewer in the same click frame. This works on mobile and
    // avoids the impression that the first tap did nothing while loading.
    const preview = beginDocumentPreview(poNumber + ".pdf");
    setBusy("po");
    try {
      const result = await fetchPoReviewPdf(poId);
      const url = URL.createObjectURL(result.pdf);
      const pages = result.previewPages.map(page => URL.createObjectURL(page));
      preview.show({
        url,
        pages,
        type: "application/pdf",
        name: poNumber + ".pdf",
      });
    } catch (error) {
      preview.fail(errMsg(error));
      toast.error("Could not prepare the PO PDF", { description: errMsg(error) });
    } finally {
      setBusy(null);
    }
  }

  async function openQuotation() {
    if (busy) return;
    if (!quotePath) {
      setMissingQuote(true);
      return;
    }
    setBusy("quotation");
    try {
      const { data, error } = await supabase.storage
        .from(PROCUREMENT_ATTACHMENT_BUCKET).download(quotePath);
      if (error) throw error;
      if (!data) throw new Error("Quotation file is not available.");
      const type = procurementAttachmentContentType(quotePath);
      if (!type) throw new Error("Unsupported attachment type. Upload a PDF or image.");
      const name = quotePath.split("/").at(-1) ?? "Supplier quotation";
      showDocument({
        url: URL.createObjectURL(new Blob([data], { type })),
        name: "Quotation - " + name,
        type,
      });
    } catch (error) {
      toast.error("Unable to open the attached quotation", { description: errMsg(error) });
    } finally { setBusy(null); }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" aria-label="Documents for PO review">
        <Button type="button" size={size} variant="outline" disabled={busy !== null}
          className="min-h-10" onClick={() => void openPo()}>
          <FileText className="mr-1 h-4 w-4" />
          {busy === "po" ? "Preparing PO…" : "View PO"}
        </Button>
        <Button type="button" size={size} variant="outline" disabled={busy !== null}
          className="min-h-10" onClick={() => void openQuotation()}>
          <Eye className="mr-1 h-4 w-4" />
          {busy === "quotation" ? "Opening…" : "View Quotation"}
        </Button>
      </div>
      <Dialog open={missingQuote} onOpenChange={setMissingQuote}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-2 text-destructive">
              <XCircle className="h-6 w-6" />
              <DialogTitle>No quotation attached</DialogTitle>
            </div>
            <DialogDescription>
              There is no supplier quotation PDF or image attached to this purchase order
              or its original purchase request. Ask the Purchase Manager or Site Engineer
              to attach the quotation before approval.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMissingQuote(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
