export type OpeningLine = {
  id: string; description: string; hsn_sac: string; unit: string;
  quantity: string; rate: string; discount: string; tax_rate: string;
};
export type HistoricPayment = {
  id: string; payment_date: string; payment_mode: string; reference: string;
  amount: string; remarks: string;
};
export type OpeningGST = "cgst_sgst"|"igst"|"none";

const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const valid = (raw:string, decimals:number) =>
  new RegExp("^\\d+(?:\\.\\d{1,"+decimals+"})?$").test(raw.trim()) && Number.isFinite(Number(raw));
const safe = (raw:string) => Number(raw) || 0;
export const isRealDate = (date:string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date+"T00:00:00Z")) &&
  new Date(date+"T00:00:00Z").toISOString().slice(0,10)===date;
export const newOpeningLine = (id:string):OpeningLine => ({
  id,description:"",hsn_sac:"",unit:"Nos",quantity:"1",rate:"",discount:"0",tax_rate:"18",
});
export const newHistoricPayment = (id:string,date:string):HistoricPayment => ({
  id,payment_date:date,payment_mode:"neft",reference:"",amount:"",remarks:"",
});
export function evaluateOpeningBill(input:{
  lines:OpeningLine[];payments:HistoricPayment[];gstType:OpeningGST;
  freight:string;otherCharges:string;tdsRate:string;legacyPaid?:number;
}) {
  const errors:string[]=[];
  if(!input.lines.length||input.lines.length>100)errors.push("Add between 1 and 100 bill items.");
  let subtotal=0,taxTotal=0;
  const computed=input.lines.map((line,index)=>{
    const name="Item "+(index+1);
    if(!line.description.trim()||line.description.length>250)errors.push(name+": enter a material/service description (up to 250 characters).");
    if(!line.unit.trim()||line.unit.length>25)errors.push(name+": enter the unit.");
    if(line.hsn_sac.length>30)errors.push(name+": HSN/SAC must be at most 30 characters.");
    const qty=safe(line.quantity),rate=safe(line.rate),discount=safe(line.discount),tax=safe(line.tax_rate);
    if(!valid(line.quantity,3)||qty<=0||qty>1_000_000)errors.push(name+": quantity must be greater than 0 (max 3 decimals).");
    if(!valid(line.rate,2)||rate<0||rate>1_000_000_000)errors.push(name+": enter a valid rate (max 2 decimals).");
    if(!valid(line.discount,2)||discount<0)errors.push(name+": enter a valid discount.");
    if(!valid(line.tax_rate,2)||tax<0||tax>100)errors.push(name+": GST rate must be between 0% and 100%.");
    if(input.gstType==="none"&&tax!==0)errors.push(name+": a non-GST bill cannot include GST.");
    const taxable=money(qty*rate-discount);
    if(taxable<0)errors.push(name+": discount cannot exceed the line value.");
    const taxAmount=money(Math.max(0,taxable)*tax/100);
    subtotal+=taxable;taxTotal+=taxAmount;
    return {taxable,taxAmount,total:money(taxable+taxAmount)};
  });
  subtotal=money(subtotal);taxTotal=money(taxTotal);
  const extra:[string,string][]=[["Freight",input.freight],["Other charges",input.otherCharges],["TDS rate",input.tdsRate]];
  for(const [label,raw] of extra)if(!valid(raw,2)||safe(raw)<0||safe(raw)>1_000_000_000)errors.push(label+" must be a nonnegative amount (max 2 decimals).");
  const tdsRate=safe(input.tdsRate);
  if(tdsRate>100)errors.push("TDS rate cannot exceed 100%.");
  const gross=money(subtotal+taxTotal+safe(input.freight)+safe(input.otherCharges));
  const tds=money(subtotal*tdsRate/100);
  const net=money(gross-tds);
  if(net<=0)errors.push("Net payable must be positive.");
  if(input.payments.length>100)errors.push("At most 100 historical payments per bill.");
  let paid=0;
  for(const [index,p] of input.payments.entries()){
    const name="Prior payment "+(index+1);
    if(!isRealDate(p.payment_date))errors.push(name+": enter a valid payment date.");
    else if(p.payment_date>new Date().toISOString().slice(0,10))errors.push(name+": future payments are not historical.");
    if(!["neft","rtgs","imps","cheque","upi","cash","card","other"].includes(p.payment_mode))
      errors.push(name+": choose a valid payment mode.");
    if(!valid(p.amount,2)||safe(p.amount)<=0||safe(p.amount)>1_000_000_000)
      errors.push(name+": enter a positive amount.");
    if(p.reference.length>150||p.remarks.length>500)errors.push(name+": reference/remarks too long.");
    paid+=safe(p.amount);
  }
  paid=money(paid);
  const legacyPaid=input.legacyPaid??0;
  if(legacyPaid+paid>net+0.001)errors.push("Historical payments cannot exceed the net payable.");
  return {subtotal,taxTotal,computed,gross,tds,net,paid,legacyPaid,
    balance:money(net-paid-legacyPaid),errors};
}
