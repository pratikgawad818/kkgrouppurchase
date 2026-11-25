/** All expected IDs must have exactly one finite result. A missing or
 * inaccessible line cannot silently become zero or pass invoice validation. */
export async function collectGrnAvailability(
  ids: readonly string[],
  fetchBatch:(ids:string[])=>Promise<{data: {grn_item_id:string;available:number|string|null}[]|null;error:{message:string}|null}>,
):Promise<Map<string,number>>{
  const result=new Map<string,number>();
  const expected=new Set(ids);
  if(expected.size!==ids.length||ids.some(id=>!id))throw new Error("Invalid or duplicate GRN item IDs.");
  for(let start=0;start<ids.length;start+=250){
    const batch=ids.slice(start,start+250);
    const wanted=new Set(batch);
    const {data,error}=await fetchBatch(batch);
    if(error)throw new Error("Could not verify accepted GRN quantities: "+error.message);
    if(!Array.isArray(data)||data.length!==batch.length)throw new Error("GRN availability response is incomplete.");
    for(const row of data){
      if(!wanted.has(row.grn_item_id)||result.has(row.grn_item_id)||row.available===null||row.available===""||!Number.isFinite(Number(row.available)))
        throw new Error("GRN availability response is invalid or inaccessible.");
      result.set(row.grn_item_id,Number(row.available));
    }
  }
  if(result.size!==ids.length)throw new Error("GRN quantity checks are incomplete.");
  return result;
}
