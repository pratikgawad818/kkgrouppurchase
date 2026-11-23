import { fmtDate, inr, num } from "@/lib/format";
import { poCommercialSummary } from "@/lib/po-commercial-summary";
import { poBuyerIdentity, type PoBuyerSnapshot } from "@/lib/po-buyer-identity";

type Company = {
  name: string; legal_name: string | null; registered_address: string | null;
  office_address: string | null; gstin: string | null; pan: string | null;
  phone: string | null; email: string | null;
} | null;
type Vendor = {
  company_name: string; gstin: string | null; pan: string | null;
  address: string | null; city: string | null; state: string | null;
  pincode: string | null; contact_person: string | null; mobile: string | null;
  email: string | null; bank_account_name?: string | null;
  bank_name?: string | null; bank_account_number?: string | null; ifsc?: string | null;
} | null;
type Po = PoBuyerSnapshot & {
  po_number: string; po_date: string; status: string;
  expected_delivery_date: string | null; payment_terms: string | null;
  delivery_terms: string | null; remarks: string | null;
  subtotal: number; discount_total: number; tax_total: number; freight: number;
  other_charges: number; grand_total: number; approved_at: string | null;
  freight_tax_type?: string; freight_tax_rate_percent?: number;
  freight_tax_amount?: number; other_charges_tax_type?: string;
  other_charges_tax_rate_percent?: number; other_charges_tax_amount?: number;
  companies: Company; vendors: Vendor; projects: { name: string } | null;
  buildings: { name: string } | null;
  warehouses: { name: string; address: string | null } | null;
  vendor_quotations?: {
    quotation_number: string; quotation_date: string; payment_terms: string | null;
    remarks: string | null;
  } | null;
  rfqs: { rfq_number: string } | null;
  purchase_requests: { pr_number: string } | null;
};
type Item = {
  id: string; line_no: number; ordered_quantity: number; rate: number;
  discount_amount: number; taxable_amount: number; tax_type: string;
  tax_rate_percent: number; tax_amount: number; line_total: number;
  items: { code: string; name: string } | null;
  units_of_measure: { code: string } | null;
};
type Hist = { action: string; profiles: { full_name: string | null } | null };

/**
 * Commercially complete buyer-issued Purchase Order, laid out in the same
 * reading order as a supplier quotation. All amounts are sourced from the PO,
 * not recomputed from the supplier PDF or overwritten at print time.
 *
 * The product quantities, units, project and delivery destination must match
 * the approved Purchase Request. Never substitute vendor wording in their place.
 */
export function PrintPo({
  po, items, history,
}: { po: Po; items: Item[]; history: Hist[] }) {
  const company = poBuyerIdentity(po);
  const vendor = po.vendors;
  const quote = po.vendor_quotations;
  const amounts = poCommercialSummary(po, items);
  const issuer = company?.legal_name || company?.name || "Company";
  const issuerAddress = company?.registered_address || company?.office_address;
  const vendorAddress = [
    vendor?.address, vendor?.city, vendor?.state, vendor?.pincode,
  ].filter(Boolean).join(", ");
  const preparedBy = history.find((event) => event.action === "created")?.profiles?.full_name;
  const approvedBy = [...history].reverse()
    .find((event) => event.action === "approved")?.profiles?.full_name;
  const paymentTerms = po.payment_terms?.trim() || quote?.payment_terms?.trim();
  const bank = [
    vendor?.bank_name, vendor?.bank_account_name,
    vendor?.bank_account_number, vendor?.ifsc,
  ].some(Boolean);
  const isDraft = po.status === "draft" || po.status === "rejected";
  const showDiscrepancy = Math.abs(amounts.difference) >= 0.01 ||
    Math.abs(amounts.gstDifference) >= 0.01;
  const taxableRate = (type: string, rate: number) =>
    type === "none" ? "Exempt" : `${num(rate)}%`;
  const taxSplit = (type: string, rate: number) =>
    type === "cgst_sgst"
      ? `CGST ${num(rate / 2)}% + SGST ${num(rate / 2)}%`
      : type === "igst" ? `IGST ${num(rate)}%` : "No GST";
  const chargeTaxNotes = [
    Number(po.freight) > 0
      ? `Freight: ${taxSplit(po.freight_tax_type ?? "none", Number(po.freight_tax_rate_percent ?? 0))}`
      : null,
    Number(po.other_charges) > 0
      ? `Other charges: ${taxSplit(po.other_charges_tax_type ?? "none", Number(po.other_charges_tax_rate_percent ?? 0))}`
      : null,
  ].filter(Boolean);

  return (
    <article className="mx-auto hidden max-w-[190mm] font-sans text-[9.5px] leading-[1.45] text-slate-900 print:block [print-color-adjust:exact]">
      <header className="overflow-hidden rounded-sm border border-slate-500">
        <div className="flex items-start justify-between gap-5 border-t-[5px] border-emerald-700 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[19px] font-extrabold uppercase tracking-tight">{issuer}</div>
            <div className="mt-1 max-w-[410px] whitespace-pre-line">{issuerAddress}</div>
            <div className="mt-1">
              {[company?.gstin && "GSTIN: " + company.gstin,
                company?.pan && "PAN: " + company.pan].filter(Boolean).join("  |  ")}
            </div>
            <div>{[company?.phone, company?.email].filter(Boolean).join("  |  ")}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[17px] font-extrabold tracking-wide">PURCHASE ORDER</div>
            <div className="mt-1 text-[12px] font-semibold">{po.po_number}</div>
            <div>PO Date: {fmtDate(po.po_date)}</div>
            {isDraft && <div className="mt-1 border border-black px-2 py-0.5 font-bold">DRAFT — NOT APPROVED</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-slate-400 bg-slate-50">
          <div className="border-r border-slate-300 px-4 py-3">
            <div className="text-[9px] font-bold uppercase">Vendor / supplier</div>
            <div className="mt-1 text-[12px] font-semibold">{vendor?.company_name || "Vendor not recorded"}</div>
            <div>{vendorAddress}</div>
            <div>{vendor?.gstin ? "GSTIN: " + vendor.gstin : "GSTIN not recorded"}</div>
            <div>
              {[vendor?.contact_person, vendor?.mobile, vendor?.email]
                .filter(Boolean).join("  |  ")}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[9px] font-bold uppercase">Delivery / project</div>
            <div className="mt-1 text-[12px] font-semibold">{po.projects?.name || "Project not recorded"}</div>
            <div>{po.buildings?.name ? "Building: " + po.buildings.name : "Building not assigned"}</div>
            <div>Ship to: {po.warehouses?.name || "Delivery warehouse not assigned"}</div>
            {po.warehouses?.address && <div>{po.warehouses.address}</div>}
            <div>Expected delivery: {fmtDate(po.expected_delivery_date)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-slate-300">
          <div className="border-r border-slate-300 px-4 py-2">
            <span className="font-semibold">Supplier quotation:</span>{" "}
            {quote?.quotation_number || "Not linked"}
            {quote?.quotation_date && <div>Quotation date: {fmtDate(quote.quotation_date)}</div>}
          </div>
          <div className="px-4 py-2">
            <div>Purchase request: {po.purchase_requests?.pr_number || "—"}</div>
            <div>RFQ: {po.rfqs?.rfq_number || "—"}</div>
          </div>
        </div>
      </header>

      <div className="mt-4 flex items-center justify-between border-b-2 border-slate-700 pb-1">
        <h2 className="text-[11px] font-bold uppercase tracking-widest">01 / Items &amp; pricing</h2>
        <span className="text-[9px] text-slate-600">All amounts in Indian Rupees (₹)</span>
      </div>
      <table className="mt-2 w-full table-fixed border-collapse border border-slate-400 text-[9px]">
        <thead className="table-header-group">
          <tr className="bg-slate-100 text-left font-bold uppercase tracking-wide">
            <th className="w-[4%] border border-slate-400 p-1 text-center">#</th>
            <th className="w-[29%] border border-slate-400 p-1">Material / description</th>
            <th className="w-[7%] border border-slate-400 p-1 text-right">Qty</th>
            <th className="w-[7%] border border-slate-400 p-1 text-center">UOM</th>
            <th className="w-[12%] border border-slate-400 p-1 text-right">Rate (₹)</th>
            <th className="w-[9%] border border-slate-400 p-1 text-right">Disc.</th>
            <th className="w-[13%] border border-slate-400 p-1 text-right">Taxable (₹)</th>
            <th className="w-[8%] border border-slate-400 p-1 text-center">GST %</th>
            <th className="w-[11%] border border-slate-400 p-1 text-right">GST (₹)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="break-inside-avoid align-top">
              <td className="border border-slate-300 p-1 text-center">{item.line_no}</td>
              <td className="break-words border border-slate-300 p-1">
                <span className="font-medium">{item.items?.name || "Material"}</span>
                {item.items?.code && <div className="text-[9px] text-gray-600">Code: {item.items.code}</div>}
              </td>
              <td className="border border-slate-300 p-1 text-right">{num(item.ordered_quantity)}</td>
              <td className="border border-slate-300 p-1 text-center">{item.units_of_measure?.code || "—"}</td>
              <td className="border border-slate-300 p-1 text-right">{inr(item.rate)}</td>
              <td className="border border-slate-300 p-1 text-right">{inr(item.discount_amount)}</td>
              <td className="border border-slate-300 p-1 text-right font-semibold">{inr(item.taxable_amount)}</td>
              <td className="border border-slate-300 p-1 text-center font-semibold">
                {taxableRate(item.tax_type, Number(item.tax_rate_percent))}
              </td>
              <td className="border border-slate-300 p-1 text-right">{inr(item.tax_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-0.5 text-right text-[9px] text-gray-700">
        GST rate shown per item (CGST+SGST combined, or IGST). Each taxable amount excludes GST;
        quantities and units reflect the approved purchasing records.
      </div>

      <section className="mt-4 break-inside-avoid overflow-hidden border border-slate-400">
        <div className="border-b border-slate-400 bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide">
          02 / Commercial terms &amp; totals
        </div>
        <div className="grid grid-cols-[1fr_255px]">
          <div className="border-r border-slate-300 p-3">
            <div className="font-semibold">Payment terms</div>
            <p className="mt-0.5 whitespace-pre-line">{paymentTerms || "Not recorded — confirm before issuing PO"}</p>
            <div className="mt-2 font-semibold">Delivery and installation terms</div>
            <p className="mt-0.5 whitespace-pre-line">
              {po.delivery_terms?.trim() || "Not recorded — confirm before issuing PO"}
            </p>
            {po.remarks?.trim() && <>
              <div className="mt-2 font-semibold">Buyer remarks</div>
              <p className="whitespace-pre-line">{po.remarks}</p>
            </>}
            {quote?.remarks?.trim() && <>
              <div className="mt-2 font-semibold">Supplier quotation notes (reference)</div>
              <p className="whitespace-pre-line">{quote.remarks}</p>
            </>}
          </div>
          <table className="w-full border-collapse text-[9.5px]">
            <tbody>
              {([
                ["Goods subtotal (ex-GST)", Number(po.subtotal)],
                ["Less: discount", -Number(po.discount_total)],
                ["Freight", Number(po.freight)],
                ["Other charges", Number(po.other_charges)],
                ["Total before GST", amounts.beforeGst],
                ["CGST", amounts.cgst],
                ["SGST", amounts.sgst],
                ["IGST", amounts.igst],
              ] as const).map(([label, amount], index) => (
                <tr key={label} className={index === 4 ? "border-y border-slate-500 bg-slate-50 font-semibold" : ""}>
                  <td className="px-2 py-0.5">{label}</td>
                  <td className="px-2 py-0.5 text-right tabular-nums">{inr(amount)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-700 bg-slate-100 font-bold">
                <td className="px-2 py-1">GRAND TOTAL</td>
                <td className="px-2 py-1 text-right text-[12px] tabular-nums">
                  {inr(po.grand_total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {chargeTaxNotes.length > 0 && (
          <div className="border-t border-slate-300 px-3 py-2 text-[9px]">
            <span className="font-semibold">Charge GST rates:</span> {chargeTaxNotes.join(" · ")}.
          </div>
        )}
        <div className="border-t border-slate-300 px-3 py-2 text-[9px]">
          Tax rates are displayed on each material line. CGST and SGST above are their
          aggregated central/state components; IGST is shown separately where applicable.
        </div>
        {(amounts.freightGst > 0 || amounts.otherGst > 0) && (
          <div className="border-t border-black px-2 py-1 text-[9px]">
            Tax clarification: GST on freight {inr(amounts.freightGst)}
            {"  |  "}GST on other charges {inr(amounts.otherGst)}.
            These amounts are already included in CGST/SGST/IGST above,
            not added again.
          </div>
        )}
        {showDiscrepancy && (
          <div className="border-t border-black p-2 font-bold">
            REVIEW REQUIRED: stored GST/PO totals do not reconcile with the printed line and charge taxes.
          </div>
        )}
      </section>

      {bank && <section className="mt-3 break-inside-avoid border border-black">
        <div className="border-b border-black bg-gray-100 px-2 py-1 font-bold uppercase">Vendor bank details (from vendor master)</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 px-2 py-1">
          <div>Bank: {vendor?.bank_name || "—"}</div>
          <div>Account holder: {vendor?.bank_account_name || "—"}</div>
          <div>Account number: {vendor?.bank_account_number || "—"}</div>
          <div>IFSC: {vendor?.ifsc || "—"}</div>
        </div>
      </section>}

      <footer className="mt-5 grid grid-cols-3 gap-3 break-inside-avoid text-center">
        <div className="border-t border-black pt-1">
          Prepared by<div className="mt-1 font-semibold">{preparedBy || "—"}</div>
        </div>
        <div className="border-t border-black pt-1">
          Approved by<div className="mt-1 font-semibold">{approvedBy || "Pending approval"}</div>
          {po.approved_at && <div>{fmtDate(po.approved_at)}</div>}
        </div>
        <div className="border-t border-black pt-1">
          Authorised signatory<div className="mt-1 font-semibold">For {issuer}</div>
        </div>
      </footer>
    </article>
  );
}
