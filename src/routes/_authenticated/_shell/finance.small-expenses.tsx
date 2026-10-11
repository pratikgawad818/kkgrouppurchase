import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, ReceiptText, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { loadCompleteRows } from "@/lib/complete-register";
import { today as todayIst } from "@/lib/finance";
import { SMALL_EXPENSE_CATEGORIES, SMALL_EXPENSE_PAYMENTS, parseSmallExpenseAmount, summarizeSmallExpenses,
  type SmallExpenseCategory, type SmallExpensePayment } from "@/lib/small-expenses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loading, PageHeader, Stat } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { PAGE } from "@/lib/fy";
import { inr, fmtDate, errMsg } from "@/lib/format";
import { selectCls } from "@/lib/po";

export const Route = createFileRoute("/_authenticated/_shell/finance/small-expenses")({
  head: () => ({meta:[{title:"Small Expenses — KK GROUP ERP"},{name:"description",content:"Audited site and office petty expenses by project and building."}]}),
  component: SmallExpenses,
});

type Form = {
  spentOn: string; category: SmallExpenseCategory; amount: string;
  method: SmallExpensePayment; paidTo: string; description: string;
  reference: string; projectId: string; buildingId: string;
};
const createForm = (): Form => ({
  spentOn: todayIst(), category:"transport", amount:"", method:"cash",
  paidTo:"", description:"", reference:"", projectId:"",buildingId:"",
});
const optionLabel = (value: string, options: Record<string, string>) => options[value] ?? value.replace(/_/g," ");
function SmallExpenses() {
  const me=useMe(), qc=useQueryClient();
  const companyId=me.data?.profile.company_id;
  const permitted=!!me.data?.permissions.has("financial.view") && !!companyId;
  const canWrite=!!me.data?.profile.is_active && !!me.data?.roles.includes("super_admin") && permitted;
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState<Form>(createForm);
  const [entryKey,setEntryKey]=useState(()=>crypto.randomUUID());
  const [projectFilter,setProjectFilter]=useState("");
  const [categoryFilter,setCategoryFilter]=useState("");
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [page,setPage]=useState(0);
  const [voidId,setVoidId]=useState<string|null>(null);
  const [voidReason,setVoidReason]=useState("");

  const register=useQuery({
    queryKey:["small-expenses",companyId],enabled:permitted,staleTime:30_000,
    queryFn:()=>loadCompleteRows(async (start,end)=>{
      const {data,count,error}=await supabase.from("site_small_expenses")
        .select("id,spent_on,project_id,building_id,category,amount,payment_method,paid_to,description,receipt_reference,status,created_at,void_reason,projects(name),buildings(name)",{count:"exact"})
        .eq("company_id",companyId!).order("id").range(start,end);
      return {data,count,error};
    },{maxRows:10000}),
  });
  const context=useQuery({
    queryKey:["small-expense-context",companyId],enabled:canWrite&&open,
    queryFn:async()=>{
      const [projects,buildings]=await Promise.all([
        supabase.from("projects").select("id,name,company_id").eq("company_id",companyId!).order("name").limit(3000),
        supabase.from("buildings").select("id,name,project_id").order("name").limit(3000),
      ]);
      if(projects.error)throw projects.error;
      if(buildings.error)throw buildings.error;
      return {projects:projects.data??[],buildings:buildings.data??[]};
    },
  });

  const save=useMutation({
    mutationFn:async()=>{
      if(!canWrite)throw new Error("Only the company super administrator can record small expenses.");
      const amount=parseSmallExpenseAmount(form.amount);
      if(amount===null)throw new Error("Enter a positive amount up to ₹50,000 with at most two decimal places.");
      if(form.paidTo.trim().length<2||form.description.trim().length<3)throw new Error("Enter the person paid and a meaningful description.");
      if(!form.spentOn||form.spentOn>todayIst())throw new Error("Select a valid date that is not in the future.");
      if(form.buildingId&&!form.projectId)throw new Error("Select a project for this building.");
      const {data,error}=await supabase.rpc("record_site_small_expense",{
        _entry_key:entryKey,_project_id:form.projectId||null,_building_id:form.buildingId||null,
        _spent_on:form.spentOn,_category:form.category,_amount:amount,_payment_method:form.method,
        _paid_to:form.paidTo.trim(),_description:form.description.trim(),
        _receipt_reference:form.reference.trim()||null,
      });
      if(error)throw error;
      return data;
    },
    onSuccess:async()=>{
      await qc.invalidateQueries({queryKey:["small-expenses"]});
      setOpen(false);setForm(createForm());setEntryKey(crypto.randomUUID());
      toast.success("Small expense recorded with audit history");
    },
    onError:e=>toast.error(errMsg(e)),
  });
  const voidExpense=useMutation({
    mutationFn:async()=>{
      if(!canWrite||!voidId)throw new Error("Not authorized.");
      if(voidReason.trim().length<5)throw new Error("Enter a clear void reason (at least 5 characters).");
      const {error}=await supabase.rpc("void_site_small_expense",{_expense_id:voidId,_reason:voidReason.trim()});
      if(error)throw error;
    },
    onSuccess:async()=>{await qc.invalidateQueries({queryKey:["small-expenses"]});setVoidId(null);setVoidReason("");toast.success("Expense voided; original entry retained for audit");},
    onError:e=>toast.error(errMsg(e)),
  });
  if(me.isLoading)return <Loading />;
  if(!permitted)return <div role="alert" className="rounded-lg border p-6 text-sm">Financial access is required to view site small expenses.</div>;
  const all=register.data??[];
  const rows=all.filter(x=>
    (!projectFilter||(projectFilter==="office"?!x.project_id:x.project_id===projectFilter))&&
    (!categoryFilter||x.category===categoryFilter)&&
    (!dateFrom||x.spent_on>=dateFrom)&&(!dateTo||x.spent_on<=dateTo));
  const total=summarizeSmallExpenses(rows);
  const filteredPage=Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE)-1));
  const pageRows=rows.slice(filteredPage*PAGE,(filteredPage+1)*PAGE);
  const setField=<K extends keyof Form>(key:K,value:Form[K])=>setForm(current=>({...current,[key]:value}));

  return <div className="pb-16">
    <PageHeader title="Small Expenses" subtitle="Record actual petty expenses paid for your sites and office. Project/building breakdown, receipts and correction history."
      actions={canWrite&&<Button size="sm" onClick={()=>{setEntryKey(crypto.randomUUID());setForm(createForm());setOpen(true);}}>
        <Plus className="mr-1 h-4 w-4"/>Record expense</Button>} />
    <p className="mb-4 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
      These are incidental expenses actually paid—not supplier invoices, purchase orders or material consumption.
      Do not enter a bill/payment already tracked elsewhere. Corrections must be voided, never overwritten.
    </p>
    {register.isLoading?<Loading/>:register.error?
      <div role="alert" className="rounded-lg border border-destructive/30 p-5 text-sm text-destructive">
        Could not load the full small-expense register. The database migration may not be deployed yet.
        No partial totals are shown. {errMsg(register.error)}
      </div>:<>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Actual small expenses" value={inr(total.total)} hint="Excludes voided entries"/>
        <Stat label="Recorded entries" value={total.count}/>
        <Stat label="Voided entries" value={total.voided} hint="Retained in audit history"/>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Project filter" className={selectCls} value={projectFilter} onChange={e=>{setProjectFilter(e.target.value);setPage(0);}}>
          <option value="">All projects and office</option>
          <option value="office">General office (no project)</option>
          {[...new Map(all.filter(x=>x.project_id).map(x=>[x.project_id!,{id:x.project_id!,name:x.projects?.name??"Project"}])).values()]
            .map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select aria-label="Category filter" className={selectCls} value={categoryFilter} onChange={e=>{setCategoryFilter(e.target.value);setPage(0);}}>
          <option value="">All categories</option>{Object.entries(SMALL_EXPENSE_CATEGORIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <Input aria-label="From date" type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(0);}}/>
        <Input aria-label="To date" type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(0);}}/>
      </div>
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-4"><h3 className="text-sm font-semibold">Category totals</h3>
          <div className="mt-3 space-y-2 text-sm">{[...total.byCategory.entries()].sort((a,b)=>b[1]-a[1]).map(([category,amount])=>
            <div key={category} className="flex justify-between gap-3"><span>{optionLabel(category,SMALL_EXPENSE_CATEGORIES)}</span><strong>{inr(amount)}</strong></div>)}
            {!total.byCategory.size&&<p className="text-xs text-muted-foreground">No recorded expenses in these filters.</p>}</div></div>
        <div className="rounded-xl border bg-card p-4"><h3 className="text-sm font-semibold">Project totals</h3>
          <div className="mt-3 space-y-2 text-sm">{[...total.byProject.entries()].sort((a,b)=>b[1]-a[1]).map(([id,amount])=>
            <div key={id} className="flex justify-between gap-3"><span>{id==="office"?"General office":all.find(x=>x.project_id===id)?.projects?.name??"Project"}</span><strong>{inr(amount)}</strong></div>)}
            {!total.byProject.size&&<p className="text-xs text-muted-foreground">No recorded expenses in these filters.</p>}</div></div>
      </div>
      <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card">
        <table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b bg-muted/30 text-xs"><tr>
          <th className="p-3">Date</th><th className="p-3">Project / building</th><th className="p-3">Category</th>
          <th className="p-3">Paid to / purpose</th><th className="p-3">Method</th><th className="p-3">Receipt</th>
          <th className="p-3 text-right">Amount</th><th className="p-3">Status</th><th className="p-3">Action</th>
        </tr></thead><tbody>{pageRows.map(x=><tr key={x.id} className="border-b last:border-0">
          <td className="p-3">{fmtDate(x.spent_on)}</td>
          <td className="p-3">{x.projects?.name??"Office"}{x.buildings?.name?" / "+x.buildings.name:""}</td>
          <td className="p-3">{optionLabel(x.category,SMALL_EXPENSE_CATEGORIES)}</td>
          <td className="p-3"><span className="font-medium">{x.paid_to}</span><p className="max-w-[260px] whitespace-normal text-xs text-muted-foreground">{x.description}</p></td>
          <td className="p-3">{optionLabel(x.payment_method,SMALL_EXPENSE_PAYMENTS)}</td>
          <td className="p-3">{x.receipt_reference??"—"}</td>
          <td className="p-3 text-right font-medium tabular-nums">{inr(x.amount)}</td>
          <td className="p-3">{x.status==="voided"?<span title={x.void_reason??""} className="text-destructive">Voided</span>:"Recorded"}</td>
          <td className="p-3">{canWrite&&x.status==="recorded"?
            <Button size="sm" variant="outline" onClick={()=>{setVoidId(x.id);setVoidReason("");}}><Undo2 className="mr-1 h-3.5 w-3.5"/>Void</Button>:"—"}</td>
        </tr>)}
          {!rows.length&&<tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No small-expense entries match.</td></tr>}
        </tbody></table>
      </div>
      <Pager page={filteredPage} size={PAGE} total={rows.length} onPage={setPage}/>
      <div className="mt-3 text-xs text-muted-foreground">Small-expense totals are paid outgoings, separate from warehouse stock and approved vendor bills. <Link to="/inventory/material-consumption" className="text-primary underline">View material consumption</Link>.</div>
    </>}
    <Dialog open={open} onOpenChange={value=>{if(!save.isPending)setOpen(value);}}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Record a small expense</DialogTitle><DialogDescription>
          Records money already spent. Entries cannot be edited or deleted. A correction must be voided with reason and entered again.
        </DialogDescription></DialogHeader>
        {context.error&&<p role="alert" className="text-sm text-destructive">{errMsg(context.error)}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="text-sm font-medium">Date *</label><Input type="date" max={todayIst()} value={form.spentOn} onChange={e=>setField("spentOn",e.target.value)}/></div>
          <div><label className="text-sm font-medium">Amount (₹) *</label><Input inputMode="decimal" placeholder="e.g. 350.00" value={form.amount} onChange={e=>setField("amount",e.target.value)} /></div>
          <div><label className="text-sm font-medium">Category *</label><select className={selectCls} value={form.category} onChange={e=>setField("category",e.target.value as SmallExpenseCategory)}>
            {Object.entries(SMALL_EXPENSE_CATEGORIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="text-sm font-medium">Paid through *</label><select className={selectCls} value={form.method} onChange={e=>setField("method",e.target.value as SmallExpensePayment)}>
            {Object.entries(SMALL_EXPENSE_PAYMENTS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="text-sm font-medium">Project</label><select className={selectCls} value={form.projectId} onChange={e=>{setForm(v=>({...v,projectId:e.target.value,buildingId:""}));}}>
            <option value="">General office / no project</option>{context.data?.projects.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div><label className="text-sm font-medium">Building / wing</label><select className={selectCls} disabled={!form.projectId} value={form.buildingId} onChange={e=>setField("buildingId",e.target.value)}>
            <option value="">General project expense</option>{context.data?.buildings.filter(x=>x.project_id===form.projectId).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div><label className="text-sm font-medium">Paid to *</label><Input maxLength={120} placeholder="Shop / worker / service provider" value={form.paidTo} onChange={e=>setField("paidTo",e.target.value)}/></div>
          <div><label className="text-sm font-medium">Receipt / bill reference</label><Input maxLength={120} placeholder="Optional receipt number" value={form.reference} onChange={e=>setField("reference",e.target.value)}/></div>
          <div className="sm:col-span-2"><label className="text-sm font-medium">What was paid for? *</label><Textarea rows={3} maxLength={500} placeholder="Purpose and site details" value={form.description} onChange={e=>setField("description",e.target.value)}/></div>
        </div>
        <p className="text-xs text-muted-foreground">No file upload, bank transaction or vendor-payment journal is generated. Keep the receipt separately for Accounts review.</p>
        <DialogFooter><Button variant="outline" onClick={()=>setOpen(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={()=>save.mutate()} disabled={save.isPending||context.isLoading||!!context.error}>
            <ReceiptText className="mr-1 h-4 w-4"/>{save.isPending?"Saving…":"Record paid expense"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!voidId} onOpenChange={value=>{if(!voidExpense.isPending&&!value)setVoidId(null);}}>
      <DialogContent>
        <DialogHeader><DialogTitle>Void expense entry?</DialogTitle>
          <DialogDescription>Original data and audit event are retained. This removes the entry from active totals; it does not reverse a bank transfer.</DialogDescription></DialogHeader>
        <Textarea rows={3} minLength={5} maxLength={500} placeholder="Reason for correction" value={voidReason} onChange={e=>setVoidReason(e.target.value)}/>
        <DialogFooter><Button variant="outline" disabled={voidExpense.isPending} onClick={()=>setVoidId(null)}>Cancel</Button>
          <Button variant="destructive" disabled={voidExpense.isPending||voidReason.trim().length<5} onClick={()=>voidExpense.mutate()}>Void entry</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
