import { poCommercialSummary } from "./po-commercial-summary.ts";

/** Browser-native, locally generated A4 PO PDF. No third-party PDF service or upload. */
export type ReviewPo = {
  po_number: string; po_date: string; status: string;
  subtotal: number | string; discount_total: number | string;
  freight: number | string; other_charges: number | string;
  tax_total: number | string; grand_total: number | string;
  freight_tax_type?: string | null; freight_tax_amount?: number | string | null;
  other_charges_tax_type?: string | null; other_charges_tax_amount?: number | string | null;
  payment_terms?: string | null; delivery_terms?: string | null;
  remarks?: string | null; expected_delivery_date?: string | null;
  companies?: {name:string;legal_name?:string|null;gstin?:string|null;registered_address?:string|null;phone?:string|null;email?:string|null}|null;
  vendors?: {company_name:string;gstin?:string|null;address?:string|null;city?:string|null;state?:string|null;pincode?:string|null;mobile?:string|null}|null;
  projects?: {name:string}|null; buildings?: {name:string}|null;
  warehouses?: {name:string;address?:string|null}|null;
  rfqs?: {rfq_number:string}|null;
  purchase_requests?: {pr_number:string}|null;
  vendor_quotations?: {quotation_number:string;quotation_date?:string|null}|null;
};
export type ReviewPoItem = {
  id:string;line_no:number;ordered_quantity:number;rate:number;discount_amount:number;
  taxable_amount:number;tax_type:string;tax_rate_percent:number;tax_amount:number;
  items:{name:string;code?:string|null}|null;
  units_of_measure:{code:string}|null;
};

const money = (v:number|string|null|undefined) => Number(v??0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const shortDate = (v:string|null|undefined) => v && /^\d{4}-\d{2}-\d{2}/.test(v)
  ? `${v.slice(8,10)}/${v.slice(5,7)}/${v.slice(0,4)}` : "Not recorded";
const ascii = (value:string) => value.normalize("NFKD").replace(/₹/g,"Rs.").replace(/[\u2013\u2014]/g,"-")
  .replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e]/g,"?");
const literal = (value:string) => ascii(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
const width = (text:string,fontSize:number) => ascii(text).length * fontSize * 0.50;

/**
 * Explicit byte offsets and built-in PDF fonts produce a valid standalone PDF
 * without dependency/lockfile changes. The A4 layout is independent of mobile
 * viewport, and every amount comes from the stored PO and its stored items.
 */
export function generatePoReviewPdf(po:ReviewPo,items:readonly ReviewPoItem[]):Blob {
  const W=595.28,H=841.89,M=40,usable=W-M*2;
  const pages:string[][]=[];
  let commands:string[]=[];let y=48;
  function push(line:string){commands.push(line);}
  function setTextColor(rgb:[number,number,number]=[0.12,0.16,0.22]){
    push(rgb.map(x=>x.toFixed(3)).join(" ")+" rg");
  }
  function drawText(s:string,x:number,top:number,size=9,bold=false,align:"left"|"right"="left"){
    if(!s)return;
    const clean=ascii(s);
    const xx=align==="right"?x-width(clean,size):x;
    setTextColor();
    push(`BT /F${bold?"2":"1"} ${size} Tf 1 0 0 1 ${xx.toFixed(2)} ${(H-top).toFixed(2)} Tm (${literal(clean)}) Tj ET`);
  }
  function rule(top:number,from=M,to=W-M){
    push("0.78 0.82 0.84 RG 0.65 w");
    push(`${from} ${(H-top).toFixed(2)} m ${to} ${(H-top).toFixed(2)} l S`);
  }
  function shade(x:number,top:number,w:number,h:number){
    push("0.95 0.97 0.96 rg");
    push(`${x.toFixed(2)} ${(H-top-h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  function wrap(s:string,maxChars:number):string[]{
    const result:string[]=[];
    for(const segment of (s||"").split(/\r?\n/)){
      let line="";
      for(const word of ascii(segment).split(/\s+/)){
        if(!word)continue;
        if(line && line.length+word.length+1>maxChars){result.push(line);line="";}
        if(word.length>maxChars){if(line){result.push(line);line="";}for(let i=0;i<word.length;i+=maxChars)result.push(word.slice(i,i+maxChars));}
        else line=line?`${line} ${word}`:word;
      }
      if(line)result.push(line);
    }
    return result.length?result:["-"];
  }
  function page(){
    if(commands.length)pages.push(commands);
    commands=[];
    y=53;
    push("0.02 0.37 0.27 rg");
    push(`0 ${(H-9).toFixed(2)} ${W} 9 re f`);
    drawText((po.companies?.legal_name||po.companies?.name||"KK GROUP").toUpperCase(),M,32,12,true);
    drawText(po.po_number,W-M,32,9,true,"right");
    rule(41);
  }
  function space(points:number){if(y+points>H-68){page();} }
  function row(label:string,value:string,bold=false){
    space(17);
    drawText(label,M+6,y,9,bold);
    drawText(value,W-M-6,y,9,bold,"right");
    y+=17;
  }
  function block(label:string,text:string,maxChars=92){
    const lines=wrap(text||"Not recorded",maxChars);
    space(28+Math.min(lines.length,15)*13);
    drawText(label.toUpperCase(),M+4,y,8,true);y+=17;
    for(const line of lines.slice(0,15)){drawText(line,M+4,y,9);y+=13;}
    y+=9;
  }
  page();
  shade(M,y,usable,72);
  drawText("PURCHASE ORDER",M+12,y+24,19,true);
  const state=po.status==="pending_approval"?"PENDING DIRECTOR APPROVAL":
    ["draft","rejected"].includes(po.status)?"NOT APPROVED - DRAFT / CORRECTION":
    po.status.toUpperCase().replaceAll("_"," ");
  drawText(state,M+12,y+43,8,true);
  drawText("PO DATE",W-M-10,y+20,8,false,"right");
  drawText(shortDate(po.po_date),W-M-10,y+36,10,true,"right");
  y+=91;
  block("Supplier",[
    po.vendors?.company_name||"Not recorded",
    [po.vendors?.address,po.vendors?.city,po.vendors?.state,po.vendors?.pincode].filter(Boolean).join(", "),
    po.vendors?.gstin?`GSTIN: ${po.vendors.gstin}`:"",
    po.vendors?.mobile?`Phone: ${po.vendors.mobile}`:""
  ].filter(Boolean).join(" | "));
  block("Project and delivery",[
    po.projects?.name||"Not recorded",
    po.buildings?.name?`Building: ${po.buildings.name}`:"",
    po.warehouses?.name?`Store: ${po.warehouses.name}`:"",
    po.warehouses?.address||"",
    `Expected: ${shortDate(po.expected_delivery_date)}`
  ].filter(Boolean).join(" | "));
  block("Linked references",[
    po.vendor_quotations?.quotation_number?`Quotation: ${po.vendor_quotations.quotation_number}`:"",
    po.rfqs?.rfq_number?`RFQ: ${po.rfqs.rfq_number}`:"",
    po.purchase_requests?.pr_number?`PR: ${po.purchase_requests.pr_number}`:""
  ].filter(Boolean).join("  |  "));
  space(42);
  shade(M,y,usable,26);drawText("ITEMS & GST BREAKDOWN",M+8,y+17,11,true);y+=38;
  function tableHead(){
    space(34);
    shade(M,y,usable,24);
    drawText("MATERIAL / DESCRIPTION",M+5,y+16,8,true);
    drawText("QTY / UNIT",M+315,y+16,8,true);
    drawText("RATE",M+407,y+16,8,true,"right");
    drawText("GST %",M+462,y+16,8,true,"right");
    drawText("TAXABLE",W-M-5,y+16,8,true,"right");
    y+=27;
  }
  tableHead();
  for(const item of items){
    const title=item.items?.name||"Material";
    const description=wrap(title,46).slice(0,5);
    const height=Math.max(30,description.length*12+12);
    if(y+height>H-68){page();tableHead();}
    description.forEach((line,i)=>drawText(line,M+5,y+13+i*12,8.5,i===0));
    const top=y+16;
    drawText(`${item.ordered_quantity} ${item.units_of_measure?.code||""}`,M+315,top,8);
    drawText(money(item.rate),M+407,top,8,false,"right");
    drawText(item.tax_type==="none"?"0":String(item.tax_rate_percent)+"%",M+462,top,8,false,"right");
    drawText(money(item.taxable_amount),W-M-5,top,8,true,"right");
    y+=height;rule(y);
  }
  y+=14;
  const sum=poCommercialSummary(po,items);
  space(180);
  shade(M,y,usable,25);drawText("COMMERCIAL SUMMARY (INR)",M+8,y+17,10,true);y+=32;
  row("Goods subtotal",money(po.subtotal));
  if(Number(po.discount_total))row("Less: discount",money(po.discount_total));
  row("Freight",money(po.freight));
  if(Number(po.other_charges))row("Other charges",money(po.other_charges));
  row("Taxable + charges before GST",money(sum.beforeGst),true);
  if(sum.cgst)row("CGST",money(sum.cgst));
  if(sum.sgst)row("SGST",money(sum.sgst));
  if(sum.igst)row("IGST",money(sum.igst));
  if(!sum.cgst&&!sum.sgst&&!sum.igst)row("GST",money(po.tax_total));
  space(32);shade(M,y-4,usable,30);drawText("GRAND TOTAL",M+8,y+16,12,true);
  drawText(`INR ${money(po.grand_total)}`,W-M-8,y+16,12,true,"right");y+=40;
  const discrepancy=Math.abs(sum.difference)>=0.01||Math.abs(sum.gstDifference)>=0.01;
  if(discrepancy){block("Amount reconciliation warning","Stored GST or grand total differs from the summed line and charge taxes; resolve before issuing this PO.");}
  block("Payment terms",po.payment_terms||"Not recorded");
  block("Delivery / installation terms",po.delivery_terms||"Not recorded");
  if(po.remarks)block("Buyer remarks",po.remarks);
  space(88);rule(y);y+=26;
  drawText("Prepared / checked by",M+5,y,9,true);
  drawText("Authorized signatory",W-M-5,y,9,true,"right");
  y+=30;drawText("Buyer-issued document - do not treat an unapproved PO as a binding order.",M,y,8); 
  if(commands.length)pages.push(commands);
  const objects:string[]=[""];const pageIds:number[]=[];
  const catalog=1,pagesId=2,font1=3,font2=4;
  objects[catalog]="<< /Type /Catalog /Pages 2 0 R >>";
  objects[font1]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[font2]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  for(const c of pages){
    const pgId=objects.length,ctId=pgId+1;pageIds.push(pgId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${ctId} 0 R >>`);
    const stream=c.join("\n")+"\n";
    objects.push(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}endstream`);
  }
  objects[pagesId]=`<< /Type /Pages /Kids [${pageIds.map(n=>`${n} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf="%PDF-1.4\n%KKERP\n";
  const offsets:number[]=[0];
  const encoder=new TextEncoder();
  for(let i=1;i<objects.length;i++){
    offsets.push(encoder.encode(pdf).length);
    pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref=encoder.encode(pdf).length;
  pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<offsets.length;i++)pdf+=`${String(offsets[i]).padStart(10,"0")} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([encoder.encode(pdf)],{type:"application/pdf"});
}
