import { poCommercialSummary } from "@/lib/po-commercial-summary";
import { poBuyerIdentity, type PoBuyerSnapshot } from "@/lib/po-buyer-identity";
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

export type PoPdfOrder = PoBuyerSnapshot & {
  po_number: string;
  po_date: string;
  status: string;
  prepared_by_name?: string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
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
  freight_tax_rate_percent?: number | null;
  other_charges_tax_rate_percent?: number | null;
  companies?: {
    name: string; legal_name: string | null; registered_address: string | null;
    office_address: string | null; gstin: string | null; pan: string | null;
    phone: string | null; email: string | null;
  } | null;
  vendors?: {
    company_name: string; gstin: string | null; address: string | null;
    city: string | null; state: string | null; pincode: string | null;
    contact_person: string | null; mobile: string | null; email: string | null;
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

const W = 595.28; // True A4 dimensions in PDF points
const H = 841.89;
const M = 34;
const CW = W - 2 * M;
const SCALE = 2.25;
const INK = "#111111";
const MUTED = "#444444";
const RULE = "#666666";
const SHADE = "#f1f1f1";
const END = H - 49;

type Alignment = "left" | "center" | "right";
type FontOptions = { bold?: boolean; color?: string; align?: Alignment; leading?: number };

function formatMoney(value: number | string | null | undefined) {
  const x = Number(value ?? 0);
  return (x < 0 ? "-₹" : "₹") + Math.abs(x).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function formatQty(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value + (value.includes("T") ? "" : "T12:00:00"));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN");
}
function font(ctx: CanvasRenderingContext2D, size: number, bold = false, color = INK) {
  ctx.font = (bold ? "bold " : "") + size + "px Arial, Helvetica, sans-serif";
  ctx.fillStyle = color;
}
function breakLines(ctx: CanvasRenderingContext2D, raw: unknown, width: number) {
  const lines: string[] = [];
  for (const line of String(raw ?? "—").split(/\r?\n/)) {
    let active = "";
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    for (const word of words) {
      const trial = active ? active + " " + word : word;
      if (active && ctx.measureText(trial).width > width) {
        lines.push(active);
        active = word;
      } else {
        active = trial;
      }
      while (active.length > 1 && ctx.measureText(active).width > width) {
        let stop = active.length - 1;
        while (stop > 1 && ctx.measureText(active.slice(0, stop)).width > width) stop--;
        lines.push(active.slice(0, stop));
        active = active.slice(stop);
      }
    }
    if (active) lines.push(active);
  }
  return lines.length ? lines : ["—"];
}
function lineCount(p: Paper, value: unknown, width: number, size = 8.4) {
  font(p.ctx, size);
  return breakLines(p.ctx, value, width - 2).length;
}
function write(
  p: Paper, value: unknown, x: number, y: number, width: number,
  size = 8.6, opt: FontOptions = {},
) {
  const leading = opt.leading ?? size * 1.42;
  const ctx = p.ctx;
  font(ctx, size, !!opt.bold, opt.color ?? INK);
  ctx.textAlign = opt.align ?? "left";
  const drawX = opt.align === "right" ? x + width
    : opt.align === "center" ? x + width / 2 : x;
  const lines = breakLines(ctx, value, width - 2);
  lines.forEach((txt, index) => ctx.fillText(txt, drawX, y + size + index * leading, width - 1));
  ctx.textAlign = "left";
  return y + lines.length * leading;
}
function drawLine(p: Paper, x1: number, y1: number, x2: number, y2: number, weight = 0.6) {
  p.ctx.beginPath();
  p.ctx.lineWidth = weight;
  p.ctx.strokeStyle = RULE;
  p.ctx.moveTo(x1, y1);
  p.ctx.lineTo(x2, y2);
  p.ctx.stroke();
}
function rect(p: Paper, x: number, y: number, w: number, h: number, fill?: string, stroke = true) {
  if (fill) {
    p.ctx.fillStyle = fill;
    p.ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    p.ctx.strokeStyle = RULE;
    p.ctx.lineWidth = 0.65;
    p.ctx.strokeRect(x, y, w, h);
  }
}
function drawPage(order: PoPdfOrder, n: number): Paper {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(W * SCALE);
  canvas.height = Math.ceil(H * SCALE);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Unable to render the purchase order on this device.");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);
  const p: Paper = { canvas, ctx, y: 36 };
  // Unlike a browser Print dialog, there is no timestamp or source URL in
  // the document margins. Actual PO date and reference stay in the header.
  drawLine(p, M, H - 32, W - M, H - 32, 0.45);
  const buyer = poBuyerIdentity(order);
  write(p, buyer?.legal_name || buyer?.name || "KK GROUP",
    M, H - 28, CW * 0.73, 7.5, { color: MUTED });
  write(p, "Page " + n, M + CW * 0.78, H - 28, CW * 0.22, 7.5,
    { color: MUTED, align: "right" });
  return p;
}
function needNewPage(p: Paper, required: number, order: PoPdfOrder, pages: Paper[]) {
  if (p.y + required <= END) return p;
  const newPage = drawPage(order, pages.length + 1);
  pages.push(newPage);
  return newPage;
}

/** Reference layout: framed company/PO header, side-by-side supplier and site,
 * and a compact document-source strip, exactly in that visual reading order. */
function drawHeader(p: Paper, po: PoPdfOrder) {
  const company = poBuyerIdentity(po);
  const supplier = po.vendors;
  const site = po.warehouses;
  const x = M, y = p.y, w = CW;
  const headerPad = 12;
  const leftW = w * 0.61;
  const cName = company?.legal_name || company?.name || "KK GROUP";
  const cAddress = company?.registered_address || company?.office_address || "Registered address not recorded";
  const contact = [company?.phone, company?.email].filter(Boolean).join(" | ") || "Contact not recorded";
  const gst = "GSTIN: " + (company?.gstin || "Not recorded") +
    (company?.pan ? "  |  PAN: " + company.pan : "");

  font(p.ctx, 8.5);
  const addressLines = lineCount(p, cAddress, leftW - 20, 8.3);
  const legalLineCount = lineCount(p, gst, w - headerPad * 2, 8.2);
  const contactLineCount = lineCount(p, contact, w - headerPad * 2, 8.2);
  const headerH = Math.max(85,
    39 + addressLines * 11 + 3 + legalLineCount * 11 + 3 + contactLineCount * 11 + 9);
  rect(p, x, y, w, headerH);
  drawLine(p, x, y + 1, x + w, y + 1, 2.25);
  write(p, cName, x + headerPad, y + 13, leftW - headerPad * 2, 17.5, { bold: true });
  write(p, "PURCHASE ORDER", x + leftW, y + 14, w - leftW - 12, 13.5,
    { bold: true, align: "right" });
  write(p, "PO No.: " + po.po_number, x + leftW, y + 37, w - leftW - 12,
    9.5, { bold: true, align: "right" });
  write(p, "PO Date: " + formatDate(po.po_date), x + leftW, y + 53,
    w - leftW - 12, 8.8, { align: "right" });
  const addrY = write(p, cAddress, x + headerPad, y + 39, leftW - headerPad * 2, 8.3,
    { leading: 11 });
  const taxY = Math.max(addrY + 3, y + 51);
  write(p, gst, x + headerPad, taxY, w - headerPad * 2, 8.2);
  write(p, contact, x + headerPad, taxY + legalLineCount * 11 + 3,
    w - headerPad * 2, 8.2);

  let rowY = y + headerH;
  const half = w / 2;
  const supplierName = supplier?.company_name || "Supplier details not available";
  const supplierAddress = [
    supplier?.address, supplier?.city, supplier?.state, supplier?.pincode,
  ].filter(Boolean).join(", ");
  const supplierContact = [supplier?.contact_person, supplier?.mobile, supplier?.email]
    .filter(Boolean).join(" | ");
  const addressLeft = supplierAddress || "Supplier address not recorded";
  const rightFields = [
    po.projects?.name || "Project not recorded",
    "Building: " + (po.buildings?.name || "General"),
    "Ship to: " + (site?.name || "Delivery store not recorded"),
    ...(site?.address ? [site.address] : []),
    "Expected delivery: " + formatDate(po.expected_delivery_date),
  ];
  const supplierNameLines = lineCount(p, supplierName, half - 22, 10);
  const supplierAddrLines = lineCount(p, addressLeft, half - 22, 8.4);
  const supplierGstLines = lineCount(p, "GSTIN: " + (supplier?.gstin || "Not recorded"),
    half - 22, 8.3);
  const supplierContactLines = supplierContact
    ? lineCount(p, supplierContact, half - 22, 8) : 0;
  const vendorHeight = 28 + supplierNameLines * 13 + 3 +
    supplierAddrLines * 11 + 3 + supplierGstLines * 12 +
    (supplierContactLines ? 4 + supplierContactLines * 10 : 0);
  const siteHeight = 26 + rightFields.reduce((total, value, index) =>
    total + lineCount(p, value, half - 22, index === 0 ? 10 : 8.5) *
      (index === 0 ? 12 : 10.2) + (index === 0 ? 2 : 0), 0);
  const middleH = Math.max(88, vendorHeight + 8, siteHeight + 8);
  rect(p, x, rowY, w, middleH, "#fafafa");
  drawLine(p, x + half, rowY, x + half, rowY + middleH);
  write(p, "VENDOR / SUPPLIER", x + headerPad, rowY + 10, half - 22, 8.2, { bold: true });
  let vY = write(p, supplierName, x + headerPad, rowY + 28, half - 22, 10,
    { bold: true, leading: 13 }) + 3;
  vY = write(p, addressLeft, x + headerPad, vY, half - 22, 8.4, { leading: 11 }) + 3;
  vY = write(p, "GSTIN: " + (supplier?.gstin || "Not recorded"),
    x + headerPad, vY, half - 22, 8.3);
  if (supplierContact) {
    write(p, supplierContact, x + headerPad, vY + 4, half - 22, 8, { leading: 10 });
  }
  write(p, "DELIVERY / PROJECT", x + half + headerPad,
    rowY + 10, half - 22, 8.2, { bold: true });
  let rightY = rowY + 26;
  rightFields.forEach((value, index) => {
    rightY = write(p, value, x + half + headerPad, rightY, half - 22,
      index === 0 ? 10 : 8.5,
      { bold: index === 0, leading: index === 0 ? 12 : 10.2 }) + (index === 0 ? 2 : 0);
  });

  rowY += middleH;
  const quote = po.vendor_quotations?.quotation_number || "Not linked";
  const quoteDate = po.vendor_quotations?.quotation_date
    ? "  |  Date: " + formatDate(po.vendor_quotations.quotation_date) : "";
  const leftRef = "Supplier quotation: " + quote + quoteDate;
  const rightRef = "Purchase request: " + (po.purchase_requests?.pr_number || "—") +
    "\nRFQ: " + (po.rfqs?.rfq_number || "—");
  const refH = Math.max(35,
    12 + Math.max(lineCount(p, leftRef, half - 23, 8.4) * 11,
      lineCount(p, rightRef, half - 23, 8.4) * 11));
  rect(p, x, rowY, w, refH);
  drawLine(p, x + half, rowY, x + half, rowY + refH);
  write(p, leftRef, x + headerPad, rowY + 10, half - 22, 8.4, { leading: 11 });
  write(p, rightRef, x + half + headerPad, rowY + 10, half - 22, 8.4, { leading: 11 });
  p.y = rowY + refH + 18;

  if (!["approved","sent","partially_received","fully_received","closed","short_closed"]
    .includes(po.status)) {
    const warning = "PENDING APPROVAL / REVIEW COPY - NOT YET A FINALISED ORDER";
    write(p, warning, M, p.y - 12, CW, 7.6, { bold: true, color: MUTED });
  }
}

const COLS = [20, 170, 39, 33, 61, 48, 67, 39, 50];
const WIDTH = COLS.reduce((a, b) => a + b, 0);
const POS = [M];
for (const col of COLS) POS.push(POS[POS.length - 1]! + col);
const HEADERS = ["#", "MATERIAL / DESCRIPTION", "QTY", "UOM",
  "RATE (₹)", "DISC.", "TAXABLE (₹)", "GST %", "GST (₹)"];
function titleBand(p: Paper, continuation = false) {
  const y = p.y;
  write(p, continuation ? "01 / ITEMS & PRICING (CONTINUED)" : "01 / ITEMS & PRICING",
    M, y, 270, 10, { bold: true });
  write(p, "All amounts in Indian Rupees (₹)", M + 290, y + 1, CW - 290,
    8, { color: MUTED, align: "right" });
  drawLine(p, M, y + 20, W - M, y + 20, 1.1);
  p.y = y + 27;
}
function tableHead(p: Paper) {
  const y = p.y, h = 25;
  rect(p, M, y, WIDTH, h, SHADE);
  for (const x of POS.slice(1, -1)) drawLine(p, x, y, x, y + h, 0.55);
  HEADERS.forEach((head, i) => {
    write(p, head, POS[i]! + 3, y + 6, COLS[i]! - 6, 7.2,
      { bold: true, align: i > 3 ? "right" : i === 0 || i === 2 || i === 3 ? "center" : "left" });
  });
  p.y = y + h;
}
function itemLabel(item: PoPdfLine) {
  const name = item.items?.name || item.description || "Material not specified";
  const note = item.description && item.items?.name && item.description.trim() !== item.items.name.trim()
    ? "\n" + item.description : "";
  const code = item.items?.code ? "\nCode: " + item.items.code : "";
  return name + note + code;
}
function itemHeight(p: Paper, item: PoPdfLine) {
  return Math.max(37, 10 + lineCount(p, itemLabel(item), COLS[1]! - 9, 8.1) * 10.2);
}
function itemRow(p: Paper, item: PoPdfLine) {
  const y = p.y, h = itemHeight(p, item);
  rect(p, M, y, WIDTH, h);
  for (const x of POS.slice(1, -1)) drawLine(p, x, y, x, y + h, 0.45);
  write(p, item.line_no, POS[0]! + 2, y + 6, COLS[0]! - 4, 8.2, { align: "center" });
  write(p, itemLabel(item), POS[1]! + 5, y + 5, COLS[1]! - 9, 8.1,
    { leading: 10.2 });
  write(p, formatQty(item.ordered_quantity), POS[2]! + 2, y + 6, COLS[2]! - 4,
    8.2, { align: "right" });
  write(p, item.units_of_measure?.code || "—", POS[3]! + 1, y + 6, COLS[3]! - 2,
    8.2, { align: "center" });
  write(p, formatMoney(item.rate), POS[4]! + 2, y + 6, COLS[4]! - 5,
    8.2, { align: "right" });
  write(p, formatMoney(item.discount_amount), POS[5]! + 2, y + 6, COLS[5]! - 5,
    8.2, { align: "right" });
  write(p, formatMoney(item.taxable_amount), POS[6]! + 2, y + 6, COLS[6]! - 5,
    8.2, { bold: true, align: "right" });
  const gst = item.tax_type === "none" ? "Exempt" : formatQty(item.tax_rate_percent) + "%";
  write(p, gst, POS[7]! + 1, y + 6, COLS[7]! - 2, 8.2,
    { bold: true, align: "center" });
  write(p, formatMoney(item.tax_amount), POS[8]! + 2, y + 6, COLS[8]! - 5,
    8.2, { align: "right" });
  p.y = y + h;
}

function tableNote(p: Paper) {
  p.y += 6;
  p.y = write(p,
    "GST rate shown per item (CGST+SGST combined, or IGST). Taxable amounts exclude GST; quantities and units reflect the approved PO.",
    M, p.y, CW, 7.9, { leading: 10.2, color: MUTED }) + 16;
}

function taxDescription(type: string | null | undefined, rate: unknown) {
  const r = Number(rate ?? 0);
  if (type === "cgst_sgst") return "CGST " + formatQty(r / 2) + "% + SGST " + formatQty(r / 2) + "%";
  if (type === "igst") return "IGST " + formatQty(r) + "%";
  return "No GST";
}
function totalRows(po: PoPdfOrder, items: PoPdfLine[]) {
  const data = poCommercialSummary(po, items);
  const rows: Array<{ label: string; amount: number; strong?: boolean }> = [
    { label: "Goods subtotal (ex-GST)", amount: Number(po.subtotal) },
    { label: "Less: discount", amount: -Number(po.discount_total) },
    { label: "Freight", amount: Number(po.freight) },
    { label: "Other charges", amount: Number(po.other_charges) },
    { label: "Total before GST", amount: data.beforeGst, strong: true },
    { label: "CGST", amount: data.cgst },
    { label: "SGST", amount: data.sgst },
    { label: "IGST", amount: data.igst },
    { label: "GRAND TOTAL", amount: Number(po.grand_total), strong: true },
  ];
  return { data, rows };
}
function commercial(p: Paper, po: PoPdfOrder, items: PoPdfLine[]) {
  const { data, rows } = totalRows(po, items);
  const x = M, y = p.y, w = CW, stripeH = 24, left = 315, right = w - left;
  const leftItems: Array<[string, string]> = [
    ["Payment terms", po.payment_terms || po.vendor_quotations?.payment_terms || "Not recorded"],
    ["Delivery and installation terms", po.delivery_terms || "Not recorded - confirm before issuing PO"],
  ];
  if (po.remarks) leftItems.push(["Remarks", po.remarks]);
  const leftNeeded = leftItems.reduce((acc, [label, value]) =>
    acc + 12 + lineCount(p, label, left - 20, 8.5) * 10 +
    lineCount(p, value, left - 20, 8.4) * 11 + 6, 16);
  const rowHeight = 17.3, bodyH = Math.max(leftNeeded + 16, rows.length * rowHeight);
  rect(p, x, y, w, stripeH, SHADE);
  write(p, "02 / COMMERCIAL TERMS & TOTALS", x + 10, y + 6, w - 20,
    10, { bold: true });
  const bodyY = y + stripeH;
  rect(p, x, bodyY, w, bodyH);
  drawLine(p, x + left, bodyY, x + left, bodyY + bodyH);
  let cy = bodyY + 12;
  for (const [label, value] of leftItems) {
    cy = write(p, label, x + 10, cy, left - 20, 8.4, { bold: true, leading: 10 }) + 3;
    cy = write(p, value, x + 10, cy, left - 20, 8.4, { leading: 11 }) + 9;
  }
  const rX = x + left;
  let ry = bodyY;
  for (let i = 0; i < rows.length; i++) {
    const entry = rows[i]!;
    const isTotal = i === rows.length - 1;
    if (entry.strong) {
      rect(p, rX, ry, right, rowHeight, SHADE, false);
      drawLine(p, rX, ry, rX + right, ry, isTotal ? 1.2 : 0.9);
    }
    write(p, entry.label, rX + 7, ry + 4, right - 92, isTotal ? 9 : 8.1,
      { bold: !!entry.strong });
    write(p, formatMoney(entry.amount), rX + right - 88, ry + 4, 81,
      isTotal ? 10.3 : 8.4, { align: "right", bold: !!entry.strong });
    ry += rowHeight;
  }
  if (ry < bodyY + bodyH) drawLine(p, rX, ry, rX + right, ry);

  let cursor = bodyY + bodyH;
  const extraTaxNotes = [
    Number(po.freight) > 0 ? "Freight: " + taxDescription(po.freight_tax_type, po.freight_tax_rate_percent) : null,
    Number(po.other_charges) > 0 ? "Other charges: " + taxDescription(po.other_charges_tax_type, po.other_charges_tax_rate_percent) : null,
  ].filter(Boolean).join(" | ");
  const notes = [
    extraTaxNotes ? "Charge GST rates: " + extraTaxNotes + "." : "",
    "Tax rates shown per material line. CGST and SGST are the central/state components; IGST is shown separately.",
    (data.freightGst || data.otherGst)
      ? "Tax clarification: GST on freight " + formatMoney(data.freightGst) +
        " | GST on other charges " + formatMoney(data.otherGst) +
        ". Both amounts are already included in GST totals above."
      : "",
  ].filter(Boolean);
  for (const note of notes) {
    const h = Math.max(19, 8 + lineCount(p, note, w - 17, 7.6) * 9.6);
    rect(p, x, cursor, w, h);
    write(p, note, x + 8, cursor + 4, w - 16, 7.6, { leading: 9.6 });
    cursor += h;
  }
  if (Math.abs(data.difference) >= 0.01 || Math.abs(data.gstDifference) >= 0.01) {
    const warning = "REVIEW REQUIRED: The stored PO total / GST does not reconcile to individual lines and charges.";
    const h = 25;
    rect(p, x, cursor, w, h, SHADE);
    write(p, warning, x + 7, cursor + 7, w - 14, 8, { bold: true });
    cursor += h;
  }
  p.y = cursor + 18;
}

function signatureRow(p: Paper, po: PoPdfOrder) {
  const w = CW / 3, y = p.y + 12;
  const labels = ["Prepared by", "Approved by", "Authorised signatory"];
  const values = [
    po.prepared_by_name || "—",
    po.approved_by_name || (po.status === "approved" || po.status === "sent"
      ? "Approval recorded" : "Pending approval"),
    "For " + (poBuyerIdentity(po)?.legal_name || poBuyerIdentity(po)?.name || "KK GROUP"),
  ];
  for (let i = 0; i < 3; i++) {
    drawLine(p, M + i * w + 3, y, M + (i + 1) * w - 9, y, 0.95);
    write(p, labels[i]!, M + i * w + 3, y + 7, w - 12, 8,
      { align: "center" });
    write(p, values[i]!, M + i * w + 3, y + 22, w - 12, 8.4,
      { align: "center", bold: true });
  }
  p.y = y + 53;
  if (po.status === "pending_approval") {
    write(p, "Review copy only. A pending approval is not an authorised sign-off.",
      M, p.y, CW, 7.5, { color: MUTED });
    p.y += 14;
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

export async function buildPoReviewDocument(order: PoPdfOrder, items: PoPdfLine[]): Promise<PoReviewDocument> {
  if (typeof document === "undefined") throw new Error("PO preview requires a browser.");
  if (!items.length) throw new Error("The purchase order has no material lines.");

  const pages: Paper[] = [];
  let p = drawPage(order, 1);
  pages.push(p);
  drawHeader(p, order);
  p = needNewPage(p, 70, order, pages);
  titleBand(p);
  tableHead(p);

  for (const item of [...items].sort((a, b) => a.line_no - b.line_no)) {
    if (p.y + itemHeight(p, item) > END - 13) {
      p = drawPage(order, pages.length + 1);
      pages.push(p);
      titleBand(p, true);
      tableHead(p);
    }
    itemRow(p, item);
  }
  // Use measured content rather than a fixed large reservation. Short POs
  // (including the uploaded KK Construction reference) should fit one A4
  // page; long orders break before the complete commercial summary.
  if (p.y + 33 > END) {
    p = drawPage(order, pages.length + 1);
    pages.push(p);
    write(p, "MATERIAL GST NOTES", M, p.y, CW, 9, { bold: true });
    p.y += 20;
  }
  tableNote(p);
  const { rows, data } = totalRows(order, items);
  const leftFields: Array<[string, string]> = [
    ["Payment terms", order.payment_terms || order.vendor_quotations?.payment_terms || "Not recorded"],
    ["Delivery and installation terms", order.delivery_terms || "Not recorded - confirm before issuing PO"],
  ];
  if (order.remarks) leftFields.push(["Remarks", order.remarks]);
  const leftNeeded = leftFields.reduce((acc, [label, value]) =>
    acc + 12 + lineCount(p, label, 295, 8.5) * 10 +
    lineCount(p, value, 295, 8.4) * 11 + 6, 16);
  const bodyHeight = Math.max(leftNeeded + 16, rows.length * 17.3);
  const extraChargeNote = Number(order.freight) > 0 || Number(order.other_charges) > 0;
  const extraTaxNote = data.freightGst !== 0 || data.otherGst !== 0;
  const unreconciled = Math.abs(data.difference) >= 0.01 || Math.abs(data.gstDifference) >= 0.01;
  const summaryHeight = 24 + bodyHeight + (extraChargeNote ? 19 : 0) +
    19 + (extraTaxNote ? 19 : 0) + (unreconciled ? 25 : 0) + 18;
  const signaturesHeight = 80;
  if (p.y + summaryHeight + signaturesHeight > END) {
    p = drawPage(order, pages.length + 1);
    pages.push(p);
    write(p, "PURCHASE ORDER - COMMERCIAL SUMMARY", M, p.y, CW, 10, { bold: true });
    p.y += 23;
  }
  commercial(p, order, items);
  p = needNewPage(p, 85, order, pages);
  signatureRow(p, order);
  return assemblePdf(pages.map(page => page.canvas));
}

/** Backwards-compatible PDF-only helper for callers that only need a Blob. */
export async function buildPoReviewPdf(order: PoPdfOrder, lines: PoPdfLine[]): Promise<Blob> {
  return (await buildPoReviewDocument(order, lines)).pdf;
}
