import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/session";
import { errMsg } from "@/lib/format";
import { downloadFinanceWorkbook,type RegisterCell } from "@/lib/finance-workbook";

export function FinanceExport({name,headers,rows,ready,count}:{name:string;headers:readonly string[];rows:()=>readonly (readonly RegisterCell[])[];ready:boolean;count:number}) {
  const me=useMe();
  const allowed=!!me.data?.profile.is_active&&me.data.roles.some(r=>r==="super_admin"||r==="accounts_manager"||r==="director");
  if(!allowed)return null;
  return <Button type="button" variant="outline" size="sm" disabled={!ready||!count}
    title="Export every matching record, not only the current page"
    onClick={()=>{try{downloadFinanceWorkbook(name+"-"+new Date().toISOString().slice(0,10),headers,rows());toast.success("Excel register exported.");}catch(e){toast.error(errMsg(e));}}}>
    <Download className="mr-1.5 h-4 w-4" aria-hidden="true"/>Export Excel ({count})
  </Button>;
}
