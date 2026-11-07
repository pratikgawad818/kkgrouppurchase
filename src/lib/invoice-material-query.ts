import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadCompleteRows } from "@/lib/complete-register";
import {
  isReportableInvoiceStatus,
  type InvoiceMaterialAllocation,
} from "@/lib/invoice-material-allocations";

/**
 * Invoice items remain a read-only source. RLS requires vendor_invoice.view
 * and restricts each record to the viewer's accessible projects.
 * Do not infer physical delivery, building usage or stock consumption here.
 */
export function useInvoiceMaterialAllocations(enabled: boolean) {
  return useQuery({
    queryKey: ["project-invoiced-materials"],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<InvoiceMaterialAllocation[]> => {
      const invoices = await loadCompleteRows(async (start, end) => {
        const { data, count, error } = await supabase
          .from("vendor_invoices")
          .select(
            "id,invoice_number,vendor_invoice_date,status,is_opening,project_id,building_id,remarks,projects(name),buildings(name),vendors(company_name)",
            { count: "exact" },
          )
          .order("id")
          .range(start, end);
        return { data, count, error };
      });
      const visible = new Map(invoices
        .filter((invoice) => isReportableInvoiceStatus(invoice.status))
        .map((invoice) => [invoice.id, invoice]));
      if (!visible.size) return [];

      const [oldLines, matchedLines] = await Promise.all([
        loadCompleteRows(async (start, end) => {
          const { data, count, error } = await supabase
            .from("opening_vendor_invoice_lines")
            .select("id,invoice_id,material_id,description,unit,quantity,taxable,items(name,code)", { count: "exact" })
            .order("id")
            .range(start, end);
          return { data, count, error };
        }),
        loadCompleteRows(async (start, end) => {
          const { data, count, error } = await supabase
            .from("vendor_invoice_items")
            .select("id,invoice_id,material_id,quantity,taxable_amount,items(name,code,units_of_measure(code))", { count: "exact" })
            .order("id")
            .range(start, end);
          return { data, count, error };
        }),
      ]);

      const rows: InvoiceMaterialAllocation[] = [];
      const headerOf = (invoiceId: string) => visible.get(invoiceId);
      for (const line of oldLines) {
        const inv = headerOf(line.invoice_id);
        if (!inv || !inv.is_opening) continue;
        rows.push({
          id: `opening:${line.id}`,
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          invoiceDate: inv.vendor_invoice_date,
          vendorName: inv.vendors?.company_name ?? "Vendor",
          status: inv.status,
          source: "opening",
          projectId: inv.project_id,
          projectName: inv.projects?.name ?? "Project",
          buildingId: inv.building_id,
          buildingName: inv.buildings?.name ?? null,
          materialId: line.material_id,
          materialName: line.items?.name ?? line.description,
          materialCode: line.items?.code ?? null,
          unit: line.unit,
          quantity: Number(line.quantity),
          taxableValue: Number(line.taxable),
          remarks: inv.remarks,
        });
      }
      for (const line of matchedLines) {
        const inv = headerOf(line.invoice_id);
        if (!inv || inv.is_opening) continue;
        rows.push({
          id: `matched:${line.id}`,
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          invoiceDate: inv.vendor_invoice_date,
          vendorName: inv.vendors?.company_name ?? "Vendor",
          status: inv.status,
          source: "matched",
          projectId: inv.project_id,
          projectName: inv.projects?.name ?? "Project",
          buildingId: inv.building_id,
          buildingName: inv.buildings?.name ?? null,
          materialId: line.material_id,
          materialName: line.items?.name ?? "Unspecified item",
          materialCode: line.items?.code ?? null,
          unit: line.items?.units_of_measure?.code ?? "",
          quantity: Number(line.quantity),
          taxableValue: Number(line.taxable_amount),
          remarks: inv.remarks,
        });
      }
      return rows;
    },
  });
}
