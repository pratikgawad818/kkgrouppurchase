const openStatuses=new Set(["approved","sent","partially_received","partially_accepted"]);
export function workspaceOrderCounts(rows:readonly {status:string;expected_delivery_date:string|null}[],today:string){
  let open=0,due=0;
  for(const row of rows){
    if(!openStatuses.has(row.status))continue;
    open++;
    if(row.expected_delivery_date!==null&&row.expected_delivery_date<=today)due++;
  }
  return {open,due};
}
export function workspacePayableTotal(rows:readonly {balance_due:number|string}[]){
  let total=0;
  for(const row of rows){
    const value=Number(row.balance_due);
    if(!Number.isFinite(value))throw new Error("Payable totals could not be verified.");
    total+=value;
  }
  return total;
}
export function workspacePayableRows<T extends {status:string}>(rows:readonly T[]){
  return rows.filter(row=>row.status==="approved"||row.status==="partially_paid");
}
