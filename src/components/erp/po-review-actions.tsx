import { useState } from "react";
import { Eye, FileText, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { beginDocumentPreview } from "@/components/erp/document-viewer";
import { openPrivateProcurementAttachment } from "@/lib/attached-document-preview";
import { buildPoReviewDocument } from "@/lib/po-pdf";
import { errMsg } from "@/lib/format";
import { documentActorNames } from "@/lib/document-actors";

/** Fetch the actual PO and its items when requested, not the full approval queue. */
export async function fetchPoReviewPdf(poId: string) {
  const [order, lines, approvalHistory] = await Promise.all([
    supabase.from("purchase_orders")
      .select("*, vendors(company_name,gstin,pan,address,city,state,pincode,contact_person,mobile,email,bank_account_name,bank_name,bank_account_number,ifsc), projects(name), buildings(name), rfqs(rfq_number), purchase_requests(pr_number), warehouses(name,address), vendor_quotations(quotation_number,quotation_date,payment_terms,remarks), companies(name,legal_name,registered_address,office_address,gstin,pan,phone,email)")
      .eq("id", poId).single(),
    supabase.from("purchase_order_items")
      .select("line_no,description,ordered_quantity,rate,discount_amount,taxable_amount,tax_type,tax_rate_percent,tax_amount,line_total,items(code,name),units_of_measure(code)")
      .eq("po_id", poId).order("line_no"),
    supabase.from("purchase_order_approvals")
      .select("action,acted_by,acted_at")
      .eq("po_id", poId).order("acted_at"),
  ]);
  if (order.error) throw order.error;
  if (lines.error) throw lines.error;
  if (approvalHistory.error) throw approvalHistory.error;
  if (!order.data) throw new Error("Purchase order not found or not accessible.");
  if (!lines.data?.length) throw new Error("This purchase order has no material lines to preview.");

  const history = approvalHistory.data ?? [];
  const creator = history.find(event => event.action === "created");
  const approver = [...history].reverse().find(event => event.action === "approved");
  // The official document-actor RPC resolves staff names within the user's
  // authorised PO. Never invent the signatories or treat submitted as approved.
  const names = await documentActorNames("purchase_order", [poId]);
  return buildPoReviewDocument({
    ...order.data,
    prepared_by_name: creator?.acted_by ? names.get(creator.acted_by) ?? null : null,
    approved_by_name: approver?.acted_by ? names.get(approver.acted_by) ?? null : null,
  }, lines.data);
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
    // Unlike the old download-then-iframe workflow, this opens the same
    // full-screen viewer immediately on the actual button tap.
    const extension = quotePath.toLowerCase().split(".").pop() || "pdf";
    const name = "Quotation - " + poNumber + "." + extension;
    setBusy("quotation");
    try {
      await openPrivateProcurementAttachment(quotePath, name);
    } catch (error) {
      toast.error("Unable to open the attached quotation", { description: errMsg(error) });
    } finally {
      setBusy(null);
    }
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
