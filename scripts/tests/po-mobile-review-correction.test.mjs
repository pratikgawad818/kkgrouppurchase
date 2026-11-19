import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePoReviewPdf } from "../../src/lib/po-review-pdf.ts";
import { workflowPresentation, workflowEventTitle } from "../../src/lib/workflow-progress.ts";

const po = {
  po_number:"PO-2026-0003",po_date:"2026-11-19",status:"pending_approval",
  subtotal:29800,discount_total:0,freight:3500,other_charges:0,
  tax_total:5994,grand_total:39294,freight_tax_type:"cgst_sgst",
  freight_tax_amount:630,other_charges_tax_type:"none",other_charges_tax_amount:0,
  payment_terms:"50% Advance and 50% after installation",delivery_terms:"Door delivery",
  expected_delivery_date:"2026-11-22",remarks:"Installation in supplier scope",
  companies:{name:"KK GROUP",legal_name:"KK GROUP",gstin:"27AAAAA",registered_address:"Palghar, India",phone:null,email:null},
  vendors:{company_name:"AXNOY Industries LLP",gstin:"27ABFFA0613F1ZO",address:"India"},
  projects:{name:"KK Park"},buildings:null,warehouses:{name:"KK Park",address:null},
  rfqs:{rfq_number:"RFQ-2026-0005"},purchase_requests:{pr_number:"PR-2026-0004"},
  vendor_quotations:{quotation_number:"AXN/PROJECT/NOV/2026/KNG"},
};
const items=[
 {id:"line-1",line_no:1,ordered_quantity:20,rate:1300,discount_amount:0,taxable_amount:26000,tax_type:"cgst_sgst",tax_rate_percent:18,tax_amount:4680,items:{name:"Speed breaker",code:"SB"},units_of_measure:{code:"MTR"}},
 {id:"line-2",line_no:2,ordered_quantity:8,rate:475,discount_amount:0,taxable_amount:3800,tax_type:"cgst_sgst",tax_rate_percent:18,tax_amount:684,items:{name:"Accessories",code:"AC"},units_of_measure:{code:"NOS"}},
];

test("View PO produces in-memory real A4 PDF with 39,294 and correct tax breakdown",async()=>{
  const pdf=generatePoReviewPdf(po,items);
  assert.equal(pdf.type,"application/pdf");
  const text=new TextDecoder().decode(await pdf.arrayBuffer());
  assert.ok(text.startsWith("%PDF-1.4"),"should be a valid PDF header");
  for(const term of ["PO-2026-0003","39,294.00","AXNOY Industries LLP","CGST","SGST","MTR","18%","PENDING DIRECTOR APPROVAL"])
    assert.ok(text.includes(term),term);
  assert.ok(text.includes("/MediaBox [0 0 595.28 841.89]"));
  assert.ok(text.includes("%%EOF"));
  const xref=Number(text.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(text.slice(xref,xref+4),"xref");
});

test("Long PR material schedules create multiple pages without losing amounts",async()=>{
  const longItems=Array.from({length:76},(_,i)=>({...items[0],id:String(i),line_no:i+1,items:{name:`Industrial steel material number ${i+1}`,code:`M-${i+1}`}}));
  const text=new TextDecoder().decode(await generatePoReviewPdf(po,longItems).arrayBuffer());
  const count=Number(text.match(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/)?.[1]??0);
  assert.ok(count>=2,"items must span pages");
  assert.ok(text.includes("Industrial steel material number 76"),"last item should be retained");
});

test("returned PO is distinguished from rejection; buyer next, not Director vote",()=>{
  const returned=workflowPresentation("purchase_order","rejected",undefined,"returned");
  assert.equal(returned.stateLabel,"Returned to purchasing for correction");
  assert.match(returned.nextOwner,/Purchase Manager/);
  assert.match(returned.nextDescription,/Site Engineer/);
  assert.equal(workflowEventTitle("purchase_order",{
    id:"event-1",action:"returned",occurredAt:"2026-11-19T10:00:00Z",
  }),"Returned to Purchase Manager for correction");
});

test("PO page has in-app review and correction, not legacy header print/download",()=>{
  const path="../../src/routes/_authenticated/_shell/procurement.purchase-orders.$id.tsx";
  const src=readFileSync(new URL(path,import.meta.url),"utf8");
  for(const expression of ["View PO","View quotation","Revert for correction","Return PR to Site Engineer","No quotation attached","return_po_for_correction","return_pr_to_site_engineer_from_po"])
    assert.ok(src.includes(expression),expression);
  assert.ok(src.includes("generatePoReviewPdf("));
  assert.ok(src.includes("showDocument("));
  assert.ok(!src.includes('onClick={() => window.print()}'));
  assert.ok(!src.includes("Download PDF"));
});

test("full-screen viewer offers back/zoom/print/download within same screen",()=>{
  const src=readFileSync(new URL("../../src/components/erp/document-viewer.tsx",import.meta.url),"utf8");
  for(const expr of ["Back to Purchase Order","Zoom in","Zoom out","Print current document","Download current document","role=\"dialog\""])
    assert.ok(src.includes(expr),expr);
});
