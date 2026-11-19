import { poCommercialSummary } from "@/lib/po-commercial-summary";
/**
 * Builds a real, multipage A4 PDF locally from the saved PO data.
 * No popups, external PDF APIs, public file storage or third-party dependency.
 * A restrained black-and-white commercial PO, with repeating item table
 * headers and printable A4 margins. The same rendered pages are supplied
 * directly to the mobile in-app viewer (which doesn't depend on native PDF plugins).
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
  description?: string | null;
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
  freight_tax_type?: string | null;
  other_charges_tax_type?: string | null;
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


type Paper = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  y: number;
};
export type PoReviewDocument = { pdf: Blob; previewPages: Blob[] };

const W = 595.28; // A4 width in PDF points
const H = 841.89; // A4 height
const M = 34;
const CW = W - M * 2;
const SCALE = 2.25;
const INK = "#000000";
const GRAY = "#5e5e5e";
const PALE = "#f2f2f2";
const RULE = "#7d7d7d";

function number(value: number | string | null | undefined, decimals = 2) {
  return Number(value ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
}
function when(value: string | null | undefined) {
  if (!value) return "Not specified";
  const d = new Date(value + (value.includes("T") ? "" : "T12:00:00"));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN");
}
function textStyle(ctx: CanvasRenderingContext2D, size: number, bold: boolean, tone: string) {
  ctx.font = (bold ? "bold " : "") + size + "px Arial, Helvetica, sans-serif";
  ctx.fillStyle = tone;
}
function wrap(ctx: CanvasRenderingContext2D, value: unknown, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of String(value ?? "—").split(/\r?\n/)) {
    let part = "";
    for (const word of (paragraph.trim().split(/\s+/).filter(Boolean).length
      ? paragraph.trim().split(/\s+/).filter(Boolean) : ["—"])) {
      const candidate = part ? part + " " + word : word;
      if (part && ctx.measureText(candidate).width > maxWidth) {
        lines.push(part);
        part = word;
      } else {
        part = candidate;
      }
      // Long GSTINs/identifiers must never spill into another table column.
      while (part.length > 1 && ctx.measureText(part).width > maxWidth) {
        let at = part.length - 1;
        while (at > 1 && ctx.measureText(part.slice(0, at)).width > maxWidth) at--;
        lines.push(part.slice(0, at));
        part = part.slice(at);
      }
    }
    lines.push(part || "—");
  }
  return lines;
}
function write(
  p: Paper, value: unknown, x: number, top: number, width: number,
  size = 9, opts: { bold?: boolean; tone?: string; step?: number; align?: "left" | "right" | "center" } = {},
) {
  const ctx = p.ctx;
  textStyle(ctx, size, !!opts.bold, opts.tone || INK);
  ctx.textAlign = opts.align || "left";
  const step = opts.step || size + 3.8;
  const lines = wrap(ctx, value, width - 1);
  const px = opts.align === "right" ? x + width : opts.align === "center" ? x + width / 2 : x;
  lines.forEach((line, i) => ctx.fillText(line, px, top + size + i * step, width));
  ctx.textAlign = "left";
  return top + lines.length * step;
}
function textHeight(p: Paper, text: unknown, width: number, size = 9, step = size + 3.8) {
  textStyle(p.ctx, size, false, INK);
  return wrap(p.ctx, text, width).length * step;
}
function rule(p: Paper, y: number, x1 = M, x2 = W - M, thick = 0.65) {
  const ctx = p.ctx;
  ctx.beginPath(); ctx.strokeStyle = RULE; ctx.lineWidth = thick;
  ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
}
function vertical(p: Paper, x: number, y1: number, y2: number) {
  p.ctx.strokeStyle = RULE;
  p.ctx.lineWidth = 0.5;
  p.ctx.beginPath(); p.ctx.moveTo(x, y1); p.ctx.lineTo(x, y2); p.ctx.stroke();
}
function paper(order: PoPdfOrder, pageNumber: number): Paper {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Cannot render the PO on this device.");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const p: Paper = { canvas, ctx, y: 43 };
  // Slim monochrome running head/footer across every page.
  rule(p, 27, M, W - M, 1);
  write(p, order.companies?.legal_name || order.companies?.name || "KK GROUP",
    M, 8, 330, 9, { bold: true });
  write(p, order.po_number + "  |  Page " + pageNumber,
    W - 215, 8, 215 - M, 8, { align: "right" });
  rule(p, H - 33, M, W - M, 0.55);
  write(p, "KK GROUP ERP  |  Purchase Order", M, H - 28, CW / 2, 7.5, { tone: GRAY });
  write(p, "Page " + pageNumber, M + CW / 2, H - 28, CW / 2, 7.5, { align: "right", tone: GRAY });
  return p;
}
const columnWidths = [20, 131, 40, 33, 61, 50, 63, 56, 73];
function edges() {
  const out = [M];
  columnWidths.forEach(w => out.push(out[out.length - 1]! + w));
  return out;
}
const cxs = edges(); // Sum = 527 PDF points, end at right A4 margin.
const columns = ["No.", "Material / description", "Qty", "Unit", "Rate", "Disc.", "Taxable", "GST", "Amount"];
const totalTableWidth = columnWidths.reduce((a, b) => a + b, 0);
function drawTableHead(p: Paper) {
  const y = p.y;
  p.ctx.fillStyle = PALE;
  p.ctx.fillRect(M, y, totalTableWidth, 31);
  for (let j = 0; j < cxs.length; j++) vertical(p, cxs[j]!, y, y + 31);
  rule(p, y, M, M + totalTableWidth, 1);
  rule(p, y + 31, M, M + totalTableWidth, 0.85);
  columns.forEach((value, i) => {
    write(p, value, cxs[i]! + 3, y + 9, columnWidths[i]! - 6, 7.6, {
      bold: true, align: i >= 2 && i !== 3 ? "right" : "left",
    });
  });
  p.y = y + 31;
}
function itemHeight(p: Paper, item: PoPdfLine) {
  const name = item.items?.name || item.description || "Material";
  const code = item.items?.code ? "\nCode: " + item.items.code : "";
  const description = item.description && item.description !== name
    ? "\n" + item.description : "";
  return Math.max(41, 10 + textHeight(p, name + code + description, columnWidths[1]! - 10, 8.1, 10.6));
}
function itemRow(p: Paper, item: PoPdfLine) {
  const y = p.y, h = itemHeight(p, item);
  const name = item.items?.name || item.description || "Material";
  const code = item.items?.code ? "\nCode: " + item.items.code : "";
  const extra = item.description && item.description !== name
    ? "\n" + item.description : "";
  for (let j = 0; j < cxs.length; j++) vertical(p, cxs[j]!, y, y + h);
  write(p, String(item.line_no), cxs[0]! + 2, y + 6, columnWidths[0]! - 4, 8.2, { align: "center" });
  write(p, name + code + extra, cxs[1]! + 5, y + 5, columnWidths[1]! - 10, 8.1, { step: 10.6 });
  const numeric = [
    number(item.ordered_quantity, 3).replace(/\.?0+$/, ""),
    item.units_of_measure?.code || "—",
    number(item.rate),
    number(item.discount_amount),
    number(item.taxable_amount),
    number(item.line_total),
  ];
  write(p, numeric[0], cxs[2]! + 2, y + 6, columnWidths[2]! - 5, 8.2, { align: "right" });
  write(p, numeric[1], cxs[3]! + 2, y + 6, columnWidths[3]! - 4, 8, { align: "center" });
  write(p, numeric[2], cxs[4]! + 2, y + 6, columnWidths[4]! - 5, 8.2, { align: "right" });
  write(p, numeric[3], cxs[5]! + 2, y + 6, columnWidths[5]! - 5, 8.2, { align: "right" });
  write(p, numeric[4], cxs[6]! + 2, y + 6, columnWidths[6]! - 5, 8.2, { align: "right" });
  const gstLabel = item.tax_type === "none" ? "Exempt" :
    (item.tax_type === "igst" ? "IGST " : "CG+SG ") + number(item.tax_rate_percent, 0) + "%";
  write(p, gstLabel, cxs[7]! + 3, y + 5, columnWidths[7]! - 6, 7.5, { align: "center" });
  write(p, number(item.tax_amount), cxs[7]! + 2, y + 19, columnWidths[7]! - 5, 8, { align: "right" });
  write(p, numeric[5], cxs[8]! + 2, y + 6, columnWidths[8]! - 5, 8.5, { align: "right", bold: true });
  rule(p, y + h, M, M + totalTableWidth, 0.6);
  p.y = y + h;
}
function boxText(p: Paper, title: string, body: unknown, x: number, top: number, width: number) {
  let y = top;
  y = write(p, title.toUpperCase(), x, y, width, 8, { bold: true, tone: GRAY }) + 5;
  y = write(p, body, x, y, width, 9.1, { step: 13 }) + 4;
  return y;
}
function pdfHeader(p: Paper, order: PoPdfOrder) {
  const issuer = order.companies;
  const supplier = order.vendors;
  const delivery = order.warehouses;
  const quote = order.vendor_quotations;
  let y = p.y;
  write(p, issuer?.legal_name || issuer?.name || "KK GROUP", M, y, CW * 0.59, 15.5, { bold: true, step: 19.5 });
  write(p, "PURCHASE ORDER", M + CW * 0.60, y, CW * 0.40, 15, { bold: true, align: "right", step: 18 });
  y += 25;
  const addrEnd = write(p, issuer?.registered_address || issuer?.office_address || "Company address not recorded",
    M, y, 293, 8.4, { step: 11 });
  write(p, "PO No.: " + order.po_number, M + CW * 0.60, y, CW * 0.40, 9, { align: "right", bold: true });
  write(p, "PO Date: " + when(order.po_date), M + CW * 0.60, y + 15, CW * 0.40, 9, { align: "right" });
  y = Math.max(addrEnd + 5, y + 32);
  const legal = ["GSTIN: " + (issuer?.gstin || "—"), issuer?.pan ? "PAN: " + issuer.pan : null,
    issuer?.phone, issuer?.email].filter(Boolean).join("  |  ");
  y = write(p, legal, M, y, CW, 8.3, { step: 11 }) + 9;
  rule(p, y, M, W - M, 1.1);
  y += 11;
  if (!["approved", "sent", "partially_received", "fully_received", "short_closed", "closed"].includes(order.status)) {
    y = write(p, "STATUS: " + order.status.replace(/_/g, " ").toUpperCase() + "  —  NOT AN ISSUED PURCHASE ORDER",
      M, y, CW, 8.5, { bold: true }) + 5;
  }

  const gap = 20, half = (CW - gap) / 2;
  const ly = y, rx = M + half + gap;
  const supplierName = supplier?.company_name || "Supplier not recorded";
  const supplierAddr = [supplier?.address, supplier?.city, supplier?.state, supplier?.pincode].filter(Boolean).join(", ");
  let left = boxText(p, "Vendor / supplier", supplierName, M, ly, half);
  left = write(p, supplierAddr || "Address not recorded", M, left, half, 8.4, { step: 11 }) + 5;
  left = write(p, "GSTIN: " + (supplier?.gstin || "—"), M, left, half, 8.4, { step: 11 });
  const contact = [supplier?.contact_person, supplier?.mobile, supplier?.email].filter(Boolean).join(" | ");
  if (contact) left = write(p, contact, M, left + 2, half, 8.4, { step: 11 });
  let right = boxText(p, "Project / delivery", order.projects?.name || "Project not recorded", rx, ly, half);
  right = write(p, "Building: " + (order.buildings?.name || "Not assigned"), rx, right, half, 8.4, { step: 11 }) + 5;
  right = write(p, "Ship to: " + (delivery?.name || "Delivery store not specified"),
    rx, right, half, 8.4, { step: 11 });
  if (delivery?.address) right = write(p, delivery.address, rx, right + 2, half, 8.4, { step: 11 });
  right = write(p, "Expected: " + when(order.expected_delivery_date), rx, right + 5, half, 8.4);
  y = Math.max(left, right) + 9;
  rule(p, y);
  y += 10;
  const refs = [
    "PR: " + (order.purchase_requests?.pr_number || "—"),
    "RFQ: " + (order.rfqs?.rfq_number || "—"),
    "Quotation: " + (quote?.quotation_number || "—"),
    "Quote date: " + when(quote?.quotation_date),
  ];
  const refWidth = CW / 2;
  const r1 = write(p, refs[0]!, M, y, refWidth - 8, 8.6);
  const r2 = write(p, refs[2]!, M + refWidth, y, refWidth - 8, 8.6);
  const r3 = write(p, refs[1]!, M, Math.max(r1, r2) + 2, refWidth - 8, 8.6);
  const r4 = write(p, refs[3]!, M + refWidth, Math.max(r1, r2) + 2, refWidth - 8, 8.6);
  y = Math.max(r3, r4) + 12;
  rule(p, y, M, W - M, 1.1);
  p.y = y + 14;
}
function totals(p: Paper, order: PoPdfOrder, items: PoPdfLine[]) {
  const amount = poCommercialSummary(order, items);
  let y = p.y + 17;
  const tx = M + 235, rw = CW - 235;
  rule(p, y, tx, W - M, 1);
  y += 7;
  const rows: Array<[string, number]> = [
    ["Goods subtotal", Number(order.subtotal)],
    ["Less: discount", -Number(order.discount_total)],
    ["Freight", Number(order.freight)],
    ["Other charges", Number(order.other_charges)],
    ["CGST", amount.cgst],
    ["SGST", amount.sgst],
    ["IGST", amount.igst],
  ];
  for (const [name, value] of rows) {
    if (Math.abs(value) < 0.001 && ["Freight", "Other charges", "CGST", "SGST", "IGST"].includes(name)) continue;
    write(p, name, tx + 5, y, 155, 9);
    write(p, number(value), tx + 160, y, rw - 165, 9, { align: "right" });
    y += 17.5;
  }
  rule(p, y + 1, tx, W - M, 1.2);
  y += 8;
  write(p, "GRAND TOTAL (INR)", tx + 5, y, 165, 10.2, { bold: true });
  write(p, number(order.grand_total), tx + 160, y, rw - 165, 12, { bold: true, align: "right" });
  y += 26;
  rule(p, y, tx, W - M, 1);
  p.y = y + 8;
  if (Math.abs(amount.difference) >= 0.01 || Math.abs(amount.gstDifference) >= 0.01) {
    p.y = write(p, "ATTENTION: Stored PO totals / GST need reconciliation before issue.",
      M, p.y + 4, CW, 8.5, { bold: true }) + 4;
  }
}
function terms(p: Paper, order: PoPdfOrder) {
  const quote = order.vendor_quotations;
  const termsList = [
    ["Payment terms", order.payment_terms || quote?.payment_terms || "Not recorded"],
    ["Delivery / installation", order.delivery_terms || "Not recorded"],
  ];
  if (order.remarks) termsList.push(["Remarks", order.remarks]);
  // Limit repeated quotation prose on the PO; its original uploaded document
  // remains accessible through the separate View Quotation action.
  let y = p.y;
  rule(p, y, M, W - M, 0.8); y += 9;
  y = write(p, "TERMS AND CONDITIONS", M, y, CW, 9, { bold: true }) + 6;
  for (const [label, body] of termsList) {
    y = write(p, label + ": " + body, M, y, CW, 8.5, { step: 12 }) + 7;
  }
  p.y = y;
}
function signatures(p: Paper, order: PoPdfOrder) {
  const y = p.y + 40;
  const w = CW / 3;
  for (let i = 0; i < 3; i++) {
    rule(p, y, M + i * w + 5, M + (i + 1) * w - 12);
  }
  ["Prepared by", "Reviewed / approved by", "Authorised signatory"].forEach((label, i) => {
    write(p, label, M + i * w + 5, y + 7, w - 17, 8.3, { align: "center" });
  });
  p.y = y + 30;
  if (order.status === "pending_approval") {
    p.y = write(p, "Review copy only. No approval or signature is implied by this preview.",
      M, p.y + 8, CW, 7.5, { tone: GRAY });
  }
}
function bytes(data: string) { return new TextEncoder().encode(data); }
async function assemblePdf(pages: HTMLCanvasElement[]): Promise<PoReviewDocument> {
  // One JPEG buffer is shared between the real PDF and the in-app mobile page
  // preview, so Android never has to rely on its native PDF iframe plugin.
  const previewPages = await Promise.all(pages.map(canvas =>
    new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
      blob ? resolve(blob) : reject(new Error("Cannot render A4 page on this device.")), "image/jpeg", 0.94)),
  ));
  const images = await Promise.all(previewPages.map(async blob => new Uint8Array(await blob.arrayBuffer())));
  const chunks: Uint8Array[] = [];
  const starts: number[] = [0];
  let count = 0;
  function append(chunk: Uint8Array) { chunks.push(chunk); count += chunk.byteLength; }
  function txt(value: string) { append(bytes(value)); }
  function obj(id: number, data: string) {
    starts[id] = count;
    txt(id + " 0 obj\n" + data + "\nendobj\n");
  }
  const objects = 2 + images.length * 3;
  txt("%PDF-1.4\n%KKERP\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [" + images.map((_, i) => (3 + i * 3) + " 0 R").join(" ") +
    "] /Count " + images.length + " >>");
  images.forEach((image, i) => {
    const pid = 3 + i * 3, iid = pid + 1, cid = pid + 2;
    obj(pid, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H +
      "] /Resources << /XObject << /Im" + (i + 1) + " " + iid + " 0 R >> >> /Contents " + cid + " 0 R >>");
    starts[iid] = count;
    txt(iid + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + pages[i]!.width +
      " /Height " + pages[i]!.height +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
      image.length + " >>\nstream\n");
    append(image);
    txt("\nendstream\nendobj\n");
    const stream = bytes("q " + W + " 0 0 " + H + " 0 0 cm /Im" + (i + 1) + " Do Q\n");
    starts[cid] = count;
    txt(cid + " 0 obj\n<< /Length " + stream.length + " >>\nstream\n");
    append(stream);
    txt("endstream\nendobj\n");
  });
  const xref = count;
  txt("xref\n0 " + (objects + 1) + "\n0000000000 65535 f \n");
  for (let id = 1; id <= objects; id++) txt(String(starts[id]).padStart(10, "0") + " 00000 n \n");
  txt("trailer\n<< /Size " + (objects + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
  const pdf = new Blob(chunks.map(chunk => new Uint8Array(chunk)), { type: "application/pdf" });
  return { pdf, previewPages };
}
export async function buildPoReviewDocument(order: PoPdfOrder, lines: PoPdfLine[]): Promise<PoReviewDocument> {
  if (typeof document === "undefined") throw new Error("Purchase Order preview requires a browser.");
  if (!lines.length) throw new Error("This purchase order has no item lines.");

  const pages: Paper[] = [];
  let p = paper(order, 1); pages.push(p);
  const nextPage = () => { p = paper(order, pages.length + 1); pages.push(p); };
  const ensure = (height: number) => {
    if (p.y + height > H - 54) nextPage();
  };
  pdfHeader(p, order);
  // First page is the commercially familiar header; later pages repeat the
  // column headings for easy reading, filing and photocopying.
  ensure(70);
  p.y = write(p, "ORDER ITEMS  |  Amounts in INR (Rs.)", M, p.y, CW, 9, { bold: true }) + 6;
  drawTableHead(p);
  for (const line of [...lines].sort((a, b) => a.line_no - b.line_no)) {
    const h = itemHeight(p, line);
    if (p.y + h > H - 63) {
      nextPage();
      p.y = write(p, "ORDER ITEMS (CONTINUED)", M, p.y, CW, 9, { bold: true }) + 8;
      drawTableHead(p);
    }
    itemRow(p, line);
  }
  ensure(212);
  totals(p, order, lines);
  const termText = [
    order.payment_terms || order.vendor_quotations?.payment_terms || "Not recorded",
    order.delivery_terms || "Not recorded", order.remarks || "",
  ];
  const termHeight = termText.reduce((sum, value) => sum + textHeight(p, value, CW, 8.5, 12) + 19, 39);
  ensure(Math.min(210, termHeight + 90));
  terms(p, order);
  ensure(98);
  signatures(p, order);
  return assemblePdf(pages.map(page => page.canvas));
}

/** Backwards-compatible PDF-only helper for callers that only need a Blob. */
export async function buildPoReviewPdf(order: PoPdfOrder, lines: PoPdfLine[]): Promise<Blob> {
  return (await buildPoReviewDocument(order, lines)).pdf;
}
