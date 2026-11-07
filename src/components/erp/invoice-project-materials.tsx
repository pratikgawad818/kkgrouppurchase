import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { FileText, Info } from "lucide-react";
import { Loading, Stat } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { PAGE } from "@/lib/fy";
import { errMsg, fmtDate, inr, num } from "@/lib/format";
import {
  summarizeInvoiceMaterialAllocations,
  type InvoiceMaterialAllocation,
} from "@/lib/invoice-material-allocations";

const allocationKey = (line: InvoiceMaterialAllocation) =>
  JSON.stringify([
    line.projectId,
    line.buildingId,
    line.materialId ?? `name:${line.materialName.trim().toLowerCase()}`,
    line.unit.trim().toUpperCase(),
  ]);

export function InvoiceProjectMaterials({
  lines,
  loading,
  error,
  canView,
  projectId,
  buildingId,
  materialId,
  search,
}: {
  lines: InvoiceMaterialAllocation[];
  loading: boolean;
  error: unknown;
  canView: boolean;
  projectId: string;
  buildingId: string;
  materialId: string;
  search: string;
}) {
  const [page, setPage] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  if (!canView) return null;

  const term = search.trim().toLowerCase();
  const filtered = lines.filter((line) =>
    (!projectId || line.projectId === projectId) &&
    (!buildingId || (buildingId === "general" ? !line.buildingId : line.buildingId === buildingId)) &&
    (!materialId || line.materialId === materialId) &&
    (!term || [
      line.materialName, line.materialCode, line.projectName, line.buildingName,
      line.invoiceNumber, line.vendorName, line.remarks,
    ].some((value) => value?.toLowerCase().includes(term)))
  );
  const grouped = summarizeInvoiceMaterialAllocations(filtered);
  const index = Math.min(page, Math.max(0, Math.ceil(grouped.length / PAGE) - 1));
  const selectedGroup = grouped.find((group) => group.key === activeKey);
  const details = selectedGroup
    ? filtered.filter((line) => allocationKey(line) === selectedGroup.key)
      .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || a.invoiceNumber.localeCompare(b.invoiceNumber))
    : [];
  const approvedInvoices = new Set(filtered
    .filter((line) => line.status === "approved" || line.status === "paid" || line.status === "partially_paid")
    .map((line) => line.invoiceId)).size;
  const invoiceCount = new Set(filtered.map((line) => line.invoiceId)).size;

  return <section className="mb-6 rounded-xl border bg-card p-4 shadow-sm sm:p-5" aria-label="Supplier invoiced materials by project">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileText className="h-5 w-5 text-primary" aria-hidden />
          Materials recorded in vendor invoices
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Shows every invoice item allocated to a project, including M40, M45, steel,
          electrical supplies, services and charges. Approved/paid quantities are
          separated from bills awaiting review. Values exclude GST.
        </p>
      </div>
    </div>
    <p className="mt-3 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span><strong>Invoice allocation is not proof of consumption.</strong> Project
      consumption and stock only change through posted material issues/returns.
      A missing building or purpose means that allocation was not recorded on the bill;
      the system does not guess where materials were used.</span>
    </p>
    {loading ? <div className="mt-4"><Loading /></div> :
      error ? <p role="alert" className="mt-4 text-sm text-destructive">
        Could not load supplier invoice materials: {errMsg(error)}
      </p> : <>
        <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Invoice material / service groups" value={String(grouped.length)} />
          <Stat label="Invoices included" value={String(invoiceCount)} />
          <Stat label="Approved / paid invoices" value={String(approvedInvoices)} />
        </div>
        {grouped.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No non-rejected vendor invoice items match the selected filters.
        </p> : <>
          <p className="mb-2 text-xs text-muted-foreground sm:hidden">Swipe to view all columns →</p>
          <div className="overflow-x-auto rounded-lg border" role="region" tabIndex={0}
            aria-label="Vendor-invoiced materials by project and building">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Project / building</th>
                  <th className="p-3 text-left">Item / material</th>
                  <th className="p-3 text-right">Approved / paid qty</th>
                  <th className="p-3 text-right">Awaiting review qty</th>
                  <th className="p-3 text-right">Invoice value (ex-GST)</th>
                  <th className="p-3 text-right">Bills</th>
                </tr>
              </thead>
              <tbody>
                {grouped.slice(index * PAGE, (index + 1) * PAGE).map((group) => <tr
                  key={group.key} className="border-t align-top hover:bg-muted/20">
                  <td className="p-3">
                    <div className="font-medium">{group.projectName}</div>
                    <div className="text-xs text-muted-foreground">{group.buildingName ?? "Building not assigned"}</div>
                  </td>
                  <td className="p-3">
                    <button type="button" className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      aria-expanded={selectedGroup?.key === group.key}
                      onClick={() => setActiveKey(selectedGroup?.key === group.key ? null : group.key)}>
                      {group.materialName}
                    </button>
                    <div className="text-xs text-muted-foreground">
                      {group.materialCode || "Free-text bill item"} · {group.unit || "Unit not recorded"}
                    </div>
                  </td>
                  <td className="p-3 text-right font-medium tabular-nums">
                    {num(group.acceptedInvoiceQuantity)} {group.unit}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {num(group.pendingInvoiceQuantity)} {group.unit}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {inr(group.acceptedInvoiceValue + group.pendingInvoiceValue)}
                  </td>
                  <td className="p-3 text-right tabular-nums">{group.invoiceCount}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <Pager page={index} total={grouped.length} size={PAGE} onPage={setPage} />
          {selectedGroup && <div className="mt-4 rounded-lg border p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{selectedGroup.materialName} · Invoice details</h3>
              <button type="button" className="text-sm text-primary hover:underline"
                onClick={() => setActiveKey(null)}>Close details</button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Each invoice can be opened for its original source. Remarks are bill notes,
              not independently verified construction usage locations.
            </p>
            <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Source invoices for selected material">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/40 text-xs"><tr>
                  {["Invoice","Date / vendor","Quantity","Status","Remarks / recorded purpose","Taxable amount"].map((heading) =>
                    <th key={heading} className="p-2 text-left">{heading}</th>)}
                </tr></thead>
                <tbody>{details.map((line) => <tr key={line.id} className="border-t align-top">
                  <td className="p-2">
                    <Link to="/finance/vendor-invoices/$id" params={{ id: line.invoiceId }}
                      className="font-medium text-primary hover:underline">{line.invoiceNumber}</Link>
                    <div className="text-xs text-muted-foreground">
                      {line.source === "opening" ? "Old bill (no PO)" : "PO / GRN matched"}
                    </div>
                  </td>
                  <td className="p-2">{fmtDate(line.invoiceDate)}
                    <div className="text-xs text-muted-foreground">{line.vendorName}</div>
                  </td>
                  <td className="p-2 tabular-nums">{num(line.quantity)} {line.unit}</td>
                  <td className="p-2 capitalize">{line.status.replaceAll("_", " ")}</td>
                  <td className="max-w-[230px] p-2 text-xs">{line.remarks?.trim() || "Not recorded"}</td>
                  <td className="p-2 tabular-nums">{inr(line.taxableValue)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>}
        </>}
      </>}
  </section>;
}
