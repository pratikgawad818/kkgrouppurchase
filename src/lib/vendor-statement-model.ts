export type StatementRow={date:string;doc:string;kind:string;note?:string;debit:number;credit:number;bal:number};
export type StatementInput={vendor:string;gstin?:string|null;year:number;opening:number;rows:readonly StatementRow[];generatedOn:string};
function paise(n:number){
  const p=Math.round(n*100);
  if(!Number.isFinite(n)||!Number.isSafeInteger(p)||Math.abs(n*100-p)>0.001)throw new Error("Invalid ledger amount");
  return p;
}
export function statementTotals(data:StatementInput){
  if(!Number.isInteger(data.year)||data.year<1900||data.year>9998||!data.vendor.trim())throw new Error("Select a valid vendor and financial year");
  if(data.rows.length>500)throw new Error("Statement exceeds 500 transactions. Use Excel export for this register.");
  const start=data.year+"-04-01",end=(data.year+1)+"-03-31";
  let running=paise(data.opening),debit=0,credit=0,previous=start;
  for(const row of data.rows){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||row.date<start||row.date>end||row.date<previous)throw new Error("Statement contains an invalid or out-of-period transaction");
    previous=row.date;
    const d=paise(row.debit),c=paise(row.credit);
    if(d<0||c<0)throw new Error("Invalid debit or credit");
    debit+=d;credit+=c;running+=c-d;
    if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||!Number.isSafeInteger(running)||running!==paise(row.bal))throw new Error("Running balance does not reconcile");
  }
  return {start,end,opening:data.opening,debit:debit/100,credit:credit/100,closing:running/100};
}
