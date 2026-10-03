import { fmtDate, inr, num } from "@/lib/format";

type Company = { name: string; legal_name: string | null; registered_address: string | null; office_address: string | null; gstin: string | null; pan: string | null; phone: string | null; email: string | null } | null;
type Vendor = { company_name: string; gstin: string | null; pan: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; contact_person: string | null; mobile: string | null; email: string | null } | null;
type Po = {
  po_number: string; po_date: string; expected_delivery_date: string | null; payment_terms: string | null; delivery_terms: string | null; remarks: string | null;
  subtotal: number; discount_total: number; freight: number; other_charges: number; grand_total: number; approved_at: string | null;
  companies: Company; vendors: Vendor; projects: { name: string } | null; buildings: { name: string } | null; warehouses: { name: string; address: string | null } | null;
  rfqs: { rfq_number: string } | null; purchase_requests: { pr_number: string } | null;
};
type Item = { id: string; line_no: number; ordered_quantity: number; rate: number; discount_amount: number; taxable_amount: number; tax_type: string; tax_rate_percent: number; tax_amount: number; line_total: number; items: { code: string; name: string } | null; units_of_measure: { code: string } | null };
type Hist = { action: string; profiles: { full_name: string | null } | null };

/** Printable PO. Hidden on screen; the only visible content when printing. Company details always come from Company Settings. */
export function PrintPo({ po, items, history }: { po: Po; items: Item[]; history: Hist[] }) {
  const c = po.companies;
  const v = po.vendors;
  let cgst = 0, sgst = 0, igst = 0;
  for (const i of items) {
    const t = Number(i.tax_amount);
    if (i.tax_type === "igst") igst += t; else if (i.tax_type === "cgst_sgst") { cgst += t / 2; sgst += t / 2; }
  }
  const approver = [...history].reverse().find((h) => h.action === "approved")?.profiles?.full_name;
  const creator = history.find((h) => h.action === "created")?.profiles?.full_name;
  const addr = c?.registered_address || c?.office_address;
  return (
    <div className="hidden text-[11px] leading-snug text-foreground print:block">
      <div className="flex items-start justify-between border-b pb-2">
        <div>
          <div className="text-lg font-bold">{c?.legal_name || c?.name}</div>
          {addr && <div className="max-w-md whitespace-pre-line">{addr}</div>}
          <div>{[c?.gstin && `GSTIN ${c.gstin}`, c?.pan && `PAN ${c.pan}`].filter(Boolean).join(" · ")}</div>
          <div>{[c?.phone, c?.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold">PURCHASE ORDER</div>
          <div className="font-mono">{po.po_number}</div>
          <div>Date {fmtDate(po.po_date)}</div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <div className="font-semibold uppercase">Vendor</div>
          <div className="font-medium">{v?.company_name}</div>
          <div>{[v?.address, v?.city, v?.state, v?.pincode].filter(Boolean).join(", ")}</div>
          <div>{[v?.gstin && `GSTIN ${v.gstin}`, v?.pan && `PAN ${v.pan}`].filter(Boolean).join(" · ")}</div>
          <div>{[v?.contact_person, v?.mobile, v?.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div>
          <div className="font-semibold uppercase">Delivery</div>
          <div>Project: {po.projects?.name}{po.buildings?.name ? ` · ${po.buildings.name}` : ""}</div>
          <div>Deliver to: {po.warehouses?.name ?? "—"}{po.warehouses?.address ? `, ${po.warehouses.address}` : ""}</div>
          <div>Expected delivery: {fmtDate(po.expected_delivery_date)}</div>
          <div>Ref: PR {po.purchase_requests?.pr_number} · RFQ {po.rfqs?.rfq_number}</div>
        </div>
      </div>
      <table className="mt-3 w-full border-collapse">
        <thead><tr className="border-y text-left">{["#", "Material", "Qty", "Unit", "Rate", "Discount", "Taxable", "Tax", "Amount"].map((h) => <th key={h} className="p-1">{h}</th>)}</tr></thead>
        <tbody>{items.map((i) => (
          <tr key={i.id} className="border-b">
            <td className="p-1">{i.line_no}</td><td className="p-1">{i.items?.name} <span className="text-muted-foreground">{i.items?.code}</span></td>
            <td className="p-1 text-right">{num(i.ordered_quantity)}</td><td className="p-1">{i.units_of_measure?.code}</td>
            <td className="p-1 text-right">{inr(i.rate)}</td><td className="p-1 text-right">{inr(i.discount_amount)}</td><td className="p-1 text-right">{inr(i.taxable_amount)}</td>
            <td className="p-1 text-right">{inr(i.tax_amount)} ({num(i.tax_rate_percent)}% {i.tax_type === "igst" ? "IGST" : i.tax_type === "cgst_sgst" ? "CGST+SGST" : ""})</td>
            <td className="p-1 text-right">{inr(i.line_total)}</td>
          </tr>))}</tbody>
      </table>
      <div className="mt-2 ml-auto w-64">
        {([["Subtotal", po.subtotal], ["Discount", -Number(po.discount_total)], ["CGST", cgst], ["SGST", sgst], ["IGST", igst], ["Freight", po.freight], ["Other charges", po.other_charges]] as const).map(([l, x]) => (
          <div key={l} className="flex justify-between"><span>{l}</span><span className="font-mono">{inr(x)}</span></div>
        ))}
        <div className="mt-1 flex justify-between border-t pt-1 font-bold"><span>Grand total</span><span className="font-mono">{inr(po.grand_total)}</span></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div><span className="font-semibold">Payment terms:</span> {po.payment_terms ?? "—"}</div>
        <div><span className="font-semibold">Delivery terms:</span> {po.delivery_terms ?? "—"}</div>
        {po.remarks && <div className="col-span-2"><span className="font-semibold">Remarks:</span> {po.remarks}</div>}
      </div>
      <div className="mt-12 grid grid-cols-3 gap-6 text-center">
        <div className="border-t pt-1">Prepared by<br />{creator ?? ""}</div>
        <div className="border-t pt-1">Approved by<br />{approver ?? ""}{po.approved_at ? ` · ${fmtDate(po.approved_at)}` : ""}</div>
        <div className="border-t pt-1">Authorised signatory<br />for {c?.legal_name || c?.name}</div>
      </div>
    </div>
  );
}
