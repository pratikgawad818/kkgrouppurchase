import { assemblePdf } from "@/lib/po-pdf";
import { statementTotals,type StatementInput } from "@/lib/vendor-statement-model";

const W=595.28,H=841.89,M=32,END=790,CW=W-2*M;
const widths=[56,90,161,73,73,CW-453];
const money=(n:number)=>n.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const date=(s:string)=>s.split("-").reverse().join("/");
type Page={canvas:HTMLCanvasElement;ctx:CanvasRenderingContext2D;y:number};
function text(p:Page,value:string,x:number,y:number,size=9,bold=false,align:CanvasTextAlign="left"){
  p.ctx.font=(bold?"bold ":"")+size+"px Arial, sans-serif";p.ctx.textAlign=align;
  p.ctx.fillStyle="#111";p.ctx.fillText(value,x,y);p.ctx.textAlign="left";
}
function wrap(p:Page,value:string,width:number,size=8.5,bold=false){
  p.ctx.font=(bold?"bold ":"")+size+"px Arial, sans-serif";
  const lines:string[]=[];
  for(const paragraph of value.split(/\r?\n/)){
    let line="";
    for(const char of paragraph){
      if(line&&p.ctx.measureText(line+char).width>width){lines.push(line);line="";}
      line+=char;
    }
    lines.push(line);
  }
  return lines;
}
function rule(p:Page,y:number){
  p.ctx.strokeStyle="#aaa";p.ctx.lineWidth=0.5;p.ctx.beginPath();p.ctx.moveTo(M,y);p.ctx.lineTo(W-M,y);p.ctx.stroke();
}
export async function buildVendorStatement(data:StatementInput){
  const totals=statementTotals(data);
  const pages:Page[]=[];
  function page():Page{
    if(pages.length>=45)throw new Error("Statement is too long for PDF. Use the Excel export instead.");
    const canvas=document.createElement("canvas");canvas.width=Math.ceil(W*2);canvas.height=Math.ceil(H*2);
    const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)throw new Error("Unable to render statement.");
    ctx.scale(2,2);ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);
    const p={canvas,ctx,y:34};pages.push(p);
    text(p,"KK GROUP ERP",M,p.y+12,12,true);text(p,"VENDOR ACCOUNT STATEMENT",W-M,p.y+12,13,true,"right");
    p.y+=30;
    for(const line of wrap(p,data.vendor,CW-4,12,true)){text(p,line,M,p.y,12,true);p.y+=15;}
    text(p,"GSTIN: "+(data.gstin||"Not recorded"),M,p.y,9);p.y+=15;
    text(p,date(totals.start)+" to "+date(totals.end),M,p.y,9);
    text(p,"Generated: "+date(data.generatedOn),W-M,p.y,8,false,"right");p.y+=15;
    text(p,"Internal group ledger · authorized records only · not an entity-specific confirmation",M,p.y,8);p.y+=13;rule(p,p.y);p.y+=14;
    rule(p,H-34);text(p,"INR · Credit increases liability; debit reduces liability",M,H-19,7.5);
    text(p,"Page "+pages.length,W-M,H-19,8,false,"right");
    return p;
  }
  function header(p:Page){
    p.ctx.fillStyle="#e9eeeb";p.ctx.fillRect(M,p.y,CW,24);
    const labels=["Date","Document","Type / details","Debit","Credit","Balance"];let x=M;
    labels.forEach((label,i)=>{text(p,label,i>=3?x+widths[i]!-5:x+5,p.y+15,8,true,i>=3?"right":"left");x+=widths[i]!;});
    p.y+=24;
  }
  let p=page();
  function row(values:string[],bold=false){
    const lines=values.map((value,i)=>wrap(p,value,widths[i]!-10,8.5,bold));
    const lineCount=Math.max(...lines.map(l=>l.length));
    const height=Math.max(23,lineCount*11+10);
    if(height>END-175)throw new Error("A statement row is too long to print safely. Use Excel export.");
    if(p.y+height>END){p=page();header(p);}
    if(p.y+height>END)throw new Error("Statement row cannot fit on the page.");
    let x=M;
    lines.forEach((ls,i)=>{ls.forEach((l,j)=>text(p,l,i>=3?x+widths[i]!-5:x+5,p.y+13+j*11,8.5,bold,i>=3?"right":"left"));x+=widths[i]!;});
    p.y+=height;rule(p,p.y);
  }
  header(p);
  row(["","","Opening balance","","",money(totals.opening)],true);
  for(const r of data.rows)row([date(r.date),r.doc,r.kind+(r.note?"\n"+r.note:""),r.debit?money(r.debit):"",r.credit?money(r.credit):"",money(r.bal)]);
  row(["","","Period totals",money(totals.debit),money(totals.credit),""],true);
  row(["","","Closing balance","","",money(totals.closing)],true);
  if(p.y+60>END){p=page();}
  p.y+=18;
  text(p,totals.closing<0?"Negative balance indicates net vendor advance.":"Positive balance indicates net payable to vendor.",M,p.y,8.5,true);p.y+=14;
  text(p,"Only approved invoices and recorded settlements are included.",M,p.y,8);p.y+=12;
  text(p,"Historical corrections adjust opening liability; advance adjustments are non-cash entries.",M,p.y,8);p.y+=12;
  text(p,"Purchase order commitments are excluded. Reconcile with source documents before external use.",M,p.y,8);
  return assemblePdf(pages.map(p=>p.canvas));
}
