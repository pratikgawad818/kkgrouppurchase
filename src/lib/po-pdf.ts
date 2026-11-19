/**
 * Builds a real, multipage A4 PDF locally from the saved PO data.
 * No popups, external PDF APIs, public file storage or third-party dependency.
 * Canvas renders browser fonts (including Indian text) and embeds each page as
 * a high-resolution JPEG in an ordinary PDF file for native zoom/print/download.
 */
export type PoPdfLine = {
  line_no: number;
  ordered_quantity: number;
  rate: number;
  discount_amount: number;
  taxable_amount: number;
  tax_type: string;
  tax_rate_percent: number;
  tax_amount: number;
  line_total: number;
  items?: { name: string; code: string } | null;
  units_of_measure?: { code: string } | null;
};

export type PoPdfOrder = {
  po_number: string;
  po_date: string;
  status: string;
  grand_total: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  freight: number;
  other_charges: number;
  payment_terms: string | null;
  delivery_terms: string | null;
  expected_delivery_date: string | null;
  remarks: string | null;
  freight_tax_amount?: number | null;
  other_charges_tax_amount?: number | null;
  companies?: {
    name: string; legal_name: string | null; registered_address: string | null;
    office_address: string | null; gstin: string | null; pan: string | null;
    phone: string | null; email: string | null;
  } | null;
  vendors?: {
    company_name: string; gstin: string | null; address: string | null;
    city: string | null; state: string | null; pincode: string | null;
    contact_person: string | null; mobile: string | null; email: string | null;
    bank_name?: string | null; bank_account_name?: string | null;
    bank_account_number?: string | null; ifsc?: string | null;
  } | null;
  projects?: { name: string } | null;
  buildings?: { name: string } | null;
  warehouses?: { name: string; address: string | null } | null;
  rfqs?: { rfq_number: string } | null;
  purchase_requests?: { pr_number: string } | null;
  vendor_quotations?: {
    quotation_number: string; quotation_date: string;
    payment_terms: string | null; remarks: string | null;
  } | null;
};

function rupees(value: number | null | undefined) {
  return "INR " + Number(value ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
function date(value: string | null | undefined) {
  if (!value) return "Not specified";
  const d = new Date(value + (value.includes("T") ? "" : "T12:00:00"));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN");
}
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const SCALE = 2;
const MARGIN = 36;
const CONTENT_W = PAGE_W - 2 * MARGIN;
type CanvasPage = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; y: number };

function startPage(order: PoPdfOrder, pageNo: number): CanvasPage {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PAGE_W * SCALE);
  canvas.height = Math.round(PAGE_H * SCALE);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot render the PO PDF.");
  context.scale(SCALE, SCALE);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_W, PAGE_H);
  context.fillStyle = "#006747";
  context.fillRect(0, 0, PAGE_W, 7);
  context.font = "bold 10px Arial, sans-serif";
  context.fillText(order.companies?.legal_name || order.companies?.name || "KK GROUP", MARGIN, 23);
  context.fillStyle = "#64748b";
  context.font = "9px Arial, sans-serif";
  context.textAlign = "right";
  context.fillText(order.po_number + " · Page " + pageNo, PAGE_W - MARGIN, 23);
  context.textAlign = "left";
  context.strokeStyle = "#cbd5e1";
  context.beginPath();
  context.moveTo(MARGIN, PAGE_H - 34);
  context.lineTo(PAGE_W - MARGIN, PAGE_H - 34);
  context.stroke();
  context.fillText("Generated from KK GROUP ERP · Official PO data", MARGIN, PAGE_H - 20);
  context.textAlign = "right";
  context.fillText("For internal review / authorised use", PAGE_W - MARGIN, PAGE_H - 20);
  context.textAlign = "left";
  return { canvas, context, y: 46 };
}

function addText(page: CanvasPage, text: string, options: {
  size?: number; bold?: boolean; color?: string; lineHeight?: number;
  right?: boolean; indent?: number; maxWidth?: number;
} = {}) {
  const { context: ctx } = page;
  const size = options.size ?? 10;
  const height = options.lineHeight ?? size * 1.47;
  const x = MARGIN + (options.indent ?? 0);
  const max = options.maxWidth ?? CONTENT_W - (options.indent ?? 0);
  ctx.font = `${options.bold ? "bold " : ""}${size}px Arial, sans-serif`;
  ctx.fillStyle = options.color ?? "#111827";
  ctx.textAlign = options.right ? "right" : "left";
  const chunks = (text || "—").split(/\s+/).filter(Boolean);
  let segment = "";
  const rows: string[] = [];
  for (const word of chunks) {
    const candidate = segment ? segment + " " + word : word;
    if (segment && ctx.measureText(candidate).width > max) {
      rows.push(segment);
      segment = word;
    } else segment = candidate;
    // Split unusually long identifiers without overflowing the PDF margin.
    while (segment.length > 1 && ctx.measureText(segment).width > max) {
      let k = segment.length - 1;
      while (k > 1 && ctx.measureText(segment.slice(0, k)).width > max) k--;
      rows.push(segment.slice(0, k));
      segment = segment.slice(k);
    }
  }
  if (segment) rows.push(segment);
  for (const row of rows.length ? rows : ["—"]) {
    ctx.fillText(row, options.right ? PAGE_W - MARGIN : x, page.y, max);
    page.y += height;
  }
  ctx.textAlign = "left";
  return page.y;
}

function section(page: CanvasPage, heading: string) {
  const ctx = page.context;
  page.y += 12;
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(MARGIN, page.y - 12, CONTENT_W, 23);
  page.y += 3;
  addText(page, heading.toUpperCase(), { size: 10, bold: true, color: "#0f172a" });
  page.y += 6;
}
function line(page: CanvasPage) {
  const ctx = page.context;
  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(MARGIN, page.y);
  ctx.lineTo(PAGE_W - MARGIN, page.y);
  ctx.stroke();
  page.y += 12;
}
function createBlob(chunks: Uint8Array[]): Blob {
  return new Blob(chunks.map(chunk => new Uint8Array(chunk)), { type: "application/pdf" });
}
function encode(str: string) { return new TextEncoder().encode(str); }

/** Assemble a standards-compatible PDF with one compressed JPEG per A4 page. */
async function canvasesToPdf(pages: HTMLCanvasElement[]): Promise<Blob> {
  const imgs = await Promise.all(pages.map(async (canvas) => {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Cannot export PO page")), "image/jpeg", 0.93));
    return new Uint8Array(await blob.arrayBuffer());
  }));
  const chunks: Uint8Array[] = [];
  const positions: number[] = [0];
  let cursor = 0;
  function append(chunk: Uint8Array) { chunks.push(chunk); cursor += chunk.byteLength; }
  function txt(value: string) { append(encode(value)); }
  function obj(id: number, data: string | Uint8Array) {
    positions[id] = cursor;
    txt(`${id} 0 obj\n`);
    if (typeof data === "string") txt(data);
    else append(data);
    txt("\nendobj\n");
  }
  const totalObjs = 2 + imgs.length * 3;
  txt("%PDF-1.4\n%KKERP\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = imgs.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${imgs.length} >>`);
  imgs.forEach((bytes, index) => {
    const pId = 3 + index * 3, iId = pId + 1, cId = pId + 2;
    obj(pId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im${index + 1} ${iId} 0 R >> >> /Contents ${cId} 0 R >>`);
    positions[iId] = cursor;
    txt(`${iId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pages[index]!.width} /Height ${pages[index]!.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
    append(bytes);
    txt("\nendstream\nendobj\n");
    const source = encode(`q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im${index + 1} Do Q\n`);
    positions[cId] = cursor;
    txt(`${cId} 0 obj\n<< /Length ${source.length} >>\nstream\n`);
    append(source);
    txt("endstream\nendobj\n");
  });
  const xref = cursor;
  txt(`xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= totalObjs; i++) txt(`${String(positions[i]).padStart(10, "0")} 00000 n \n`);
  txt(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return createBlob(chunks);
}

export async function buildPoReviewPdf(po: PoPdfOrder, items: PoPdfLine[]): Promise<Blob> {
  if (typeof document === "undefined") throw new Error("PO PDF is only available in the browser.");
  const pages: CanvasPage[] = [];
  let page = startPage(po, 1);
  pages.push(page);
  function fresh() { page = startPage(po, pages.length + 1); pages.push(page); }
  function fit(height = 65) { if (page.y + height > PAGE_H - 52) fresh(); }

  const vendor = po.vendors;
  const company = po.companies;
  addText(page, "PURCHASE ORDER", { size: 22, bold: true, color: "#006747", lineHeight: 30 });
  addText(page, po.po_number + "  |  Date: " + date(po.po_date), { size: 12, bold: true });
  if (po.status !== "approved" && po.status !== "sent" && !po.status.includes("received")) {
    addText(page, "NOT YET ISSUED — " + po.status.replace(/_/g, " ").toUpperCase(), { size: 9, bold: true, color: "#b45309" });
  }
  line(page);
  addText(page, company?.legal_name || company?.name || "KK GROUP", { size: 15, bold: true });
  addText(page, company?.registered_address || company?.office_address || "Registered company address not provided", { size: 9 });
  addText(page, ["GSTIN: " + (company?.gstin || "—"), "PAN: " + (company?.pan || "—")].join("  ·  "), { size: 9 });
  addText(page, [company?.phone, company?.email].filter(Boolean).join("  ·  ") || " ", { size: 9 });

  section(page, "Supplier & delivery");
  addText(page, "Supplier: " + (vendor?.company_name || "Not recorded"), { size: 12, bold: true });
  addText(page, [vendor?.address, vendor?.city, vendor?.state, vendor?.pincode].filter(Boolean).join(", "), { size: 9 });
  addText(page, "Supplier GSTIN: " + (vendor?.gstin || "Not recorded"), { size: 9 });
  addText(page, "Project: " + (po.projects?.name || "Not recorded") + (po.buildings?.name ? " / " + po.buildings.name : ""), { size: 10 });
  addText(page, "Deliver to: " + (po.warehouses?.name || "Not specified"), { size: 9 });
  if (po.warehouses?.address) addText(page, po.warehouses.address, { size: 9 });
  addText(page, "Expected delivery: " + date(po.expected_delivery_date), { size: 9 });

  section(page, "Source document references");
  addText(page, "PR: " + (po.purchase_requests?.pr_number || "—") + "    RFQ: " + (po.rfqs?.rfq_number || "—"), { size: 10 });
  addText(page, "Supplier quotation: " + (po.vendor_quotations?.quotation_number || "—"), { size: 10 });

  section(page, "Material, quantity and pricing");
  const sorted = [...items].sort((a,b)=>a.line_no-b.line_no);
  for (const item of sorted) {
    fit(70);
    addText(page, `${item.line_no}. ${item.items?.name || "Material"} ${item.items?.code ? "(" + item.items.code + ")" : ""}`, {
      size: 11, bold: true,
    });
    addText(page, `Qty: ${item.ordered_quantity} ${item.units_of_measure?.code || ""}    Rate: ${rupees(item.rate)}    Discount: ${rupees(item.discount_amount)}`, { size: 9 });
    addText(page, `Taxable: ${rupees(item.taxable_amount)}    GST: ${item.tax_type === "none" ? "Exempt" : item.tax_type + " " + item.tax_rate_percent + "%"} (${rupees(item.tax_amount)})`, { size: 9 });
    addText(page, `Line total: ${rupees(item.line_total)}`, { size: 9, bold: true });
    line(page);
  }
  fit(170);
  section(page, "Commercial totals");
  for (const [label, value] of [
    ["Goods subtotal (before discount)", po.subtotal],
    ["Discount", -Number(po.discount_total)],
    ["Freight", Number(po.freight)],
    ["Other charges", Number(po.other_charges)],
    ["GST total including charges", Number(po.tax_total)],
  ] as const) {
    addText(page, `${label}:  ${rupees(value)}`, { size: 10 });
  }
  page.y += 5;
  addText(page, "GRAND TOTAL: " + rupees(po.grand_total), { size: 15, bold: true, color: "#006747", lineHeight: 22 });
  if (po.freight_tax_amount || po.other_charges_tax_amount) {
    addText(page, `GST on freight: ${rupees(po.freight_tax_amount)}; GST on other charges: ${rupees(po.other_charges_tax_amount)} (included above)`, { size: 9 });
  }
  fit(135);
  section(page, "Terms & approval");
  addText(page, "Payment: " + (po.payment_terms || po.vendor_quotations?.payment_terms || "Not recorded"), { size: 10 });
  addText(page, "Delivery: " + (po.delivery_terms || "Not recorded"), { size: 10 });
  if (po.remarks) addText(page, "Remarks: " + po.remarks, { size: 9 });
  if (po.vendor_quotations?.remarks) addText(page, "Quotation notes: " + po.vendor_quotations.remarks, { size: 9 });
  fit(90);
  page.y += 25;
  addText(page, "Prepared by: ______________________    Approved by: ______________________", { size: 10 });
  addText(page, "Authorised signatory: " + (company?.legal_name || company?.name || "KK GROUP"), { size: 10, bold: true });

  return canvasesToPdf(pages.map(p => p.canvas));
}
