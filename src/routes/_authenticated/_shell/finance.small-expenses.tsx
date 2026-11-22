import { PermanentDelete } from "@/components/erp/permanent-delete";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, ReceiptText, Paperclip, X, SlidersHorizontal, Search, ChevronRight, CalendarDays, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
// These backend objects are not yet installed in the live database (pending approved rollout), so they are absent from generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedDb = supabase as any;
import { useMe } from "@/lib/session";
import { loadCompleteRows } from "@/lib/complete-register";
import { today as todayIst } from "@/lib/finance";
import { scopeSmallExpenseProjectOptions } from "@/lib/small-expense-project-scope";
import { SMALL_EXPENSE_CATEGORIES, SMALL_EXPENSE_PAYMENTS, matchesSmallExpenseVendor, smallExpenseVendorSuggestions, parseSmallExpenseAmount, summarizeSmallExpenses,
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
import { SmallExpenseDetail, getSmallExpenseBills, type SmallExpenseRecord } from "@/components/erp/small-expense-detail";
import { uploadSmallExpenseBill, removeSmallExpenseBill, validateSmallExpenseBill,
  SMALL_EXPENSE_BILL_ACCEPT, SMALL_EXPENSE_MAX_BILLS, type ExpenseBill } from "@/lib/small-expense-bills";

export const Route = createFileRoute("/_authenticated/_shell/finance/small-expenses")({
  head: () => ({meta:[{title:"Small Expenses — KK GROUP ERP"},{name:"description",content:"Audited site and office petty expenses by project and building."}]}),
  component: SmallExpenses,
});

type Form = {
  spentOn: string; category: SmallExpenseCategory; amount: string;
  method: SmallExpensePayment; paidTo: string; description: string;
  reference: string; projectId: string; buildingId: string;
  otherCategoryDetail: string;
};
const createForm = (): Form => ({
  spentOn: todayIst(), category:"transport", amount:"", method:"cash",
  paidTo:"", description:"", reference:"", projectId:"",buildingId:"",
  otherCategoryDetail:"",
});
const optionLabel = (value: string, options: Record<string, string>) => options[value] ?? value.replace(/_/g," ");
function SmallExpenses() {
  const me=useMe(), qc=useQueryClient();
  const companyId=me.data?.profile.company_id;
  const isSuperAdmin=!!me.data?.roles.includes("super_admin");
  const isDirector=!!me.data?.roles.includes("director");
  const isAccountsManager=!!me.data?.roles.includes("accounts_manager");
  // Site Engineers need only this narrow permission, NOT broad financial.view.
  const isSiteEngineer=!!me.data?.roles.includes("site_engineer") &&
    !isSuperAdmin && !isAccountsManager && !isDirector;
  const canCreateOwn=!!me.data?.permissions.has("small_expense.create") && isSiteEngineer;
  const permitted=!!companyId && (
    !!me.data?.permissions.has("financial.view") || canCreateOwn
  );
  const canEdit=!!me.data?.profile.is_active && permitted &&
    !!me.data?.permissions.has("small_expense.manage") &&
    (isSuperAdmin || (isAccountsManager && !isDirector));
  const canCreate=canEdit || (!!me.data?.profile.is_active && canCreateOwn);
  const canDelete=canEdit && isSuperAdmin;
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState<Form>(createForm);
  const [entryKey,setEntryKey]=useState(()=>crypto.randomUUID());
  const [editingId,setEditingId]=useState<string|null>(null);
  const [correctionReason,setCorrectionReason]=useState("");
  const [editingVersion,setEditingVersion]=useState<string|null>(null);
  const [viewing,setViewing]=useState<SmallExpenseRecord|null>(null);
  const [newBills,setNewBills]=useState<File[]>([]);
  const [removedBillPaths,setRemovedBillPaths]=useState<string[]>([]);
  const [projectFilter,setProjectFilter]=useState("");
  const [buildingFilter,setBuildingFilter]=useState("");
  const [categoryFilter,setCategoryFilter]=useState("");
  const [vendorFilter,setVendorFilter]=useState("");
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [page,setPage]=useState(0);
  const [mobileFiltersOpen,setMobileFiltersOpen]=useState(false);

  const register=useQuery({
    queryKey:["small-expenses",companyId,me.data?.profile.id,isSiteEngineer],enabled:permitted,staleTime:30_000,
    queryFn:()=>loadCompleteRows<any>(async (start,end)=>{
      let query=untypedDb.from("site_small_expenses")
        .select("id,spent_on,project_id,building_id,created_by,category,other_category_detail,amount,payment_method,paid_to,description,receipt_reference,status,created_at,updated_at,projects(name),buildings(name)",{count:"exact"})
        .eq("company_id",companyId!).eq("status","recorded");
      // Defense-in-depth: Site Engineers never download another user's rows,
      // so filters, vendor suggestions and aggregate totals are own-only.
      if (isSiteEngineer) query=query.eq("created_by",me.data!.profile.id);
      const {data,count,error}=await query
        .order("spent_on",{ascending:false})
        .order("created_at",{ascending:false})
        .order("id",{ascending:false}).range(start,end);
      return {data,count,error};
    },{maxRows:10000}),
  });
  const context=useQuery({
    queryKey:["small-expense-context",companyId,me.data?.profile.id,isSiteEngineer],enabled:canCreate&&open,
    queryFn:async()=>{
      // Fetch ONLY the signed-in engineer's explicit assignments. Company-wide
      // project visibility alone must never authorize an expense allocation.
      let assignedIds:string[]=[];
      if(isSiteEngineer){
        const {data,error}=await supabase.from("user_project_assignments")
          .select("project_id").eq("user_id",me.data!.profile.id);
        if(error)throw error; // Fail closed; never fall back to all projects.
        assignedIds=[...new Set((data??[]).map(assignment=>assignment.project_id))];
        if(!assignedIds.length)return {projects:[],buildings:[]};
      }
      let projectQuery=supabase.from("projects")
        .select("id,name,company_id").eq("company_id",companyId!);
      let buildingQuery=supabase.from("buildings").select("id,name,project_id");
      if(isSiteEngineer){
        projectQuery=projectQuery.in("id",assignedIds);
        buildingQuery=buildingQuery.in("project_id",assignedIds);
      }
      const [projects,buildings]=await Promise.all([
        projectQuery.order("name").limit(3000),
        buildingQuery.order("name").limit(3000),
      ]);
      if(projects.error)throw projects.error;
      if(buildings.error)throw buildings.error;
      // Defense-in-depth: remove any leaked project/building rows before
      // populating selectors or validating submissions.
      return scopeSmallExpenseProjectOptions(projects.data??[],buildings.data??[],assignedIds,isSiteEngineer);
    },
  });

  const editBills=useQuery<ExpenseBill[]>({
    queryKey:["small-expense-bills",editingId],
    enabled:!!editingId&&open,
    queryFn:()=>getSmallExpenseBills(editingId!),
    staleTime:0,
  });

  const startNew=()=>{
    setEditingId(null);setEditingVersion(null);setCorrectionReason("");
    setEntryKey(crypto.randomUUID());setForm(createForm());
    setNewBills([]);setRemovedBillPaths([]);setOpen(true);
  };
  const addBillFiles=(selected: File[])=>{
    try {
      selected.forEach(validateSmallExpenseBill);
      const remaining=(editBills.data??[]).filter(b=>!removedBillPaths.includes(b.storage_path)).length;
      if (remaining+newBills.length+selected.length>SMALL_EXPENSE_MAX_BILLS)
        throw new Error("Maximum 8 bill images or PDFs per expense.");
      setNewBills(old=>[...old,...selected]);
    } catch(error) { toast.error(errMsg(error)); }
  };

  const save=useMutation({
    mutationFn:async()=>{
      if(editingId ? !canEdit : !canCreate)
        throw new Error("This role cannot create or edit expenses.");
      const amount=parseSmallExpenseAmount(form.amount);
      if(amount===null)throw new Error("Enter a positive amount with up to two decimal places.");
      if(form.paidTo.trim().length<2||form.description.trim().length<3)
        throw new Error("Enter the person paid and a meaningful description.");
      if(!form.spentOn||form.spentOn>todayIst())
        throw new Error("Select a valid date that is not in the future.");
      const otherCategoryDetail=form.category==="other"?form.otherCategoryDetail.trim():"";
      if(otherCategoryDetail&&(otherCategoryDetail.length<2||otherCategoryDetail.length>120))
        throw new Error("Other category details must be 2–120 characters.");
      if(form.buildingId&&!form.projectId)throw new Error("Select a project for this building.");
      if(isSiteEngineer&&!form.projectId)
        throw new Error("Select your assigned project for this expense.");
      if(isSiteEngineer && !context.data?.projects.some(project=>project.id===form.projectId))
        throw new Error("You are not assigned to this project.");
      if(form.buildingId && !context.data?.buildings.some(building=>
        building.id===form.buildingId && building.project_id===form.projectId))
        throw new Error("Choose a building belonging to your selected project.");
      const fields={
        _entry_key:entryKey,_project_id:form.projectId||null,_building_id:form.buildingId||null,
        _spent_on:form.spentOn,_category:form.category,_amount:amount,_payment_method:form.method,
        _paid_to:form.paidTo.trim(),_description:form.description.trim(),
        _receipt_reference:form.reference.trim()||null,
        _other_category_detail:otherCategoryDetail||null,
      };
      if(editingId && !editingVersion)throw new Error("Reload this expense before editing.");
      const {data,error}=editingId
        ? await untypedDb.rpc("edit_site_small_expense",{
          _expense_id:editingId,_expected_updated_at:editingVersion,
          _payload:{
            project_id:fields._project_id,building_id:fields._building_id,
            spent_on:fields._spent_on,category:fields._category,amount:fields._amount,
            payment_method:fields._payment_method,paid_to:fields._paid_to,
            description:fields._description,receipt_reference:fields._receipt_reference,
            other_category_detail:fields._other_category_detail,
          },
          _reason:correctionReason.trim()||null,
        })
        : await untypedDb.rpc("record_site_small_expense_detailed",fields);
      if(error)throw error;
      const expenseId=String(data);
      let attached=0;
      const billFailures:string[]=[];
      // The financial row is saved before storage operations. If an upload
      // fails, report partial success without creating a second expense.
      for(const path of removedBillPaths){
        try {await removeSmallExpenseBill(expenseId,path);}
        catch(error){billFailures.push("Could not remove an old bill: "+errMsg(error));}
      }
      for(const file of newBills){
        try {
          await uploadSmallExpenseBill(file,companyId!,me.data!.profile.id,expenseId);
          attached++;
        } catch(error){billFailures.push(file.name+": "+errMsg(error));}
      }
      return {expenseId,corrected:!!editingId,attached,billFailures};
    },
    onSuccess:async(result)=>{
      await qc.invalidateQueries({queryKey:["small-expenses"]});
      await qc.invalidateQueries({queryKey:["small-expense-bills",result.expenseId]});
      await qc.invalidateQueries({queryKey:["small-expense-detail",result.expenseId]});
      setOpen(false);setForm(createForm());setEntryKey(crypto.randomUUID());
      setEditingId(null);setEditingVersion(null);setCorrectionReason("");
      setNewBills([]);setRemovedBillPaths([]);
      if(result.billFailures.length)toast.warning("Expense saved, but some bills failed. Open the expense to check.",{
        description:result.billFailures.slice(0,2).join(" | "),
        duration:9000,
      });
      else toast.success(result.corrected
        ?"Expense updated in place — no duplicate or void entry"
        :result.attached?"Expense and bills recorded":"Expense recorded");
    },
    onError:e=>toast.error(errMsg(e)),
  });
  if(me.isLoading)return <Loading />;
  if(!permitted)return <div role="alert" className="rounded-lg border p-6 text-sm">You do not have permission to view or record small expenses.</div>;
  const all=register.data??[];
  const vendorSuggestions=smallExpenseVendorSuggestions(all);
  const rows=all.filter(x=>
    (!projectFilter||(projectFilter==="office"?!x.project_id:x.project_id===projectFilter))&&
    (!buildingFilter||(buildingFilter==="general"?!x.building_id:x.building_id===buildingFilter))&&
    (!categoryFilter||x.category===categoryFilter)&&
    matchesSmallExpenseVendor(x.paid_to,vendorFilter)&&
    (!dateFrom||x.spent_on>=dateFrom)&&(!dateTo||x.spent_on<=dateTo));
  const total=summarizeSmallExpenses(rows);
  const filteredPage=Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE)-1));
  const pageRows=rows.slice(filteredPage*PAGE,(filteredPage+1)*PAGE);
  const activeFilterCount=[projectFilter,buildingFilter,categoryFilter,dateFrom,dateTo]
    .filter(Boolean).length;
  const clearFilters=()=>{
    setProjectFilter("");setBuildingFilter("");setCategoryFilter("");
    setVendorFilter("");setDateFrom("");setDateTo("");setPage(0);
  };
  const buildingOptions=[...new Map(all
    .filter(x=>!!x.building_id&&(!projectFilter||projectFilter==="office"||x.project_id===projectFilter))
    .map(x=>[x.building_id!,{id:x.building_id!,name:x.buildings?.name??"Building",project:x.projects?.name??"Project"}]))
    .values()].sort((a,b)=>(a.project+" "+a.name).localeCompare(b.project+" "+b.name));
  const setField=<K extends keyof Form>(key:K,value:Form[K])=>setForm(current=>({...current,[key]:value}));
  const beginCorrection=(record: typeof all[number])=>{
    setEditingId(record.id);
    setEditingVersion(record.updated_at);
    setNewBills([]);setRemovedBillPaths([]);
    setEntryKey(crypto.randomUUID());
    setCorrectionReason("");
    setForm({
      spentOn:record.spent_on,category:record.category,amount:String(record.amount),
      method:record.payment_method,paidTo:record.paid_to,description:record.description,
      reference:record.receipt_reference??"",projectId:record.project_id??"",
      otherCategoryDetail:record.other_category_detail??"",
      buildingId:record.building_id??"",
    });
    setOpen(true);
  };

  return <div className="min-w-0 pb-20 sm:pb-16">
    <PageHeader title={isSiteEngineer?"My Small Expenses":"Small Expenses"}
      subtitle={isSiteEngineer
        ?"Your expenses only · Assigned projects"
        :"Record actual petty expenses paid for your sites and office. Project/building breakdown, receipts and correction history."}
      actions={canCreate&&<Button size="sm" className={isSiteEngineer?"min-h-11 w-full justify-center gap-2 text-sm sm:w-auto":undefined} onClick={startNew}>
        <Plus className="h-4 w-4" aria-hidden="true"/>Record expense</Button>} />
    {isSiteEngineer
      ?<details className="mb-4 rounded-xl border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">What should I record here?</summary>
        <p className="mt-2 leading-relaxed">Only expenses you actually paid for your assigned sites. Do not enter a supplier invoice, a purchase order or material consumption again. Only your own records are shown here; authorized management can review them.</p>
      </details>
      :<p className="mb-4 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        These are incidental expenses actually paid—not supplier invoices, purchase orders or material consumption.
        Do not enter a bill/payment already tracked elsewhere. You can view full details and attached bills; authorized edits update the same expense without creating a replacement.
      </p>}
    {register.isLoading?<Loading/>:register.error?
      <div role="alert" className="rounded-lg border border-destructive/30 p-5 text-sm text-destructive">
        Could not load the full small-expense register. The database migration may not be deployed yet.
        No partial totals are shown. {errMsg(register.error)}
      </div>:<>
      {isSiteEngineer&&<section aria-label="My expense summary" className="mb-4 flex min-w-0 items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-4 shadow-card md:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">My total paid expenses</p>
          <p className="mt-1 break-words text-[clamp(1.35rem,6vw,2rem)] font-bold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]">{inr(total.total)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Based on the filters below</p>
        </div>
        <div className="shrink-0 rounded-xl bg-muted/70 px-3 py-2 text-center">
          <div className="text-xl font-semibold tabular-nums">{total.count}</div>
          <div className="text-[11px] text-muted-foreground">Entries</div>
        </div>
      </section>}
      <div className={isSiteEngineer?"mb-4 hidden gap-3 md:grid md:grid-cols-2":"mb-4 grid gap-3 sm:grid-cols-2"}>
        <Stat label={isSiteEngineer?"My paid expenses":"Total paid expenses"} value={inr(total.total)} hint={isSiteEngineer?"Only expenses entered by you":"Current recorded expenses"}/>
        <Stat label="Expense entries" value={total.count}/>
      </div>
      {isSiteEngineer&&<div className="mb-3 flex min-w-0 items-center gap-2 md:hidden">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
          <Input aria-label="Search my expenses by vendor or payee"
            className="min-h-11 w-full pl-9" placeholder="Search shop or paid to…"
            list="my-small-expense-vendors"
            value={vendorFilter} onChange={e=>{setVendorFilter(e.target.value);setPage(0);}}/>
          <datalist id="my-small-expense-vendors">
            {vendorSuggestions.map(name=><option key={name} value={name}/>)}
          </datalist>
        </div>
        <Button type="button" variant="outline" className="min-h-11 shrink-0 gap-1.5 px-3"
          aria-controls="my-small-expense-filters" aria-expanded={mobileFiltersOpen}
          onClick={()=>setMobileFiltersOpen(open=>!open)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true"/>
          Filters{activeFilterCount>0?` (${activeFilterCount})`:null}
        </Button>
      </div>}
      <div id={isSiteEngineer?"my-small-expense-filters":undefined}
        className={isSiteEngineer
          ?mobileFiltersOpen
            ?"mb-3 grid min-w-0 grid-cols-1 gap-3 rounded-2xl border bg-card p-3 shadow-sm md:flex md:flex-wrap md:border-0 md:bg-transparent md:p-0 md:shadow-none"
            :"mb-3 hidden flex-wrap gap-2 md:flex"
          :"mb-3 flex flex-wrap gap-2"}>
        <select aria-label="Project filter" className={isSiteEngineer?selectCls+" min-w-0 w-full md:w-auto":selectCls} value={projectFilter} onChange={e=>{setProjectFilter(e.target.value);setBuildingFilter("");setPage(0);}}>
          <option value="">{isSiteEngineer?"All my projects":"All projects and office"}</option>
          {!isSiteEngineer&&<option value="office">General office (no project)</option>}
          {[...new Map(all.filter(x=>x.project_id).map(x=>[x.project_id!,{id:x.project_id!,name:x.projects?.name??"Project"}])).values()]
            .map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select aria-label="Building filter" className={isSiteEngineer?selectCls+" min-w-0 w-full md:w-auto":selectCls} value={buildingFilter}
          disabled={projectFilter==="office"} onChange={e=>{setBuildingFilter(e.target.value);setPage(0);}}>
          <option value="">All buildings and general work</option>
          <option value="general">General project work / no building</option>
          {buildingOptions.map(x=><option key={x.id} value={x.id}>{x.project} / {x.name}</option>)}
        </select>
        <select aria-label="Category filter" className={isSiteEngineer?selectCls+" min-w-0 w-full md:w-auto":selectCls} value={categoryFilter} onChange={e=>{setCategoryFilter(e.target.value);setPage(0);}}>
          <option value="">All categories</option>{Object.entries(SMALL_EXPENSE_CATEGORIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <div className={isSiteEngineer?"hidden min-w-0 flex-1 md:block md:min-w-[190px] md:max-w-[280px]":"min-w-[190px] flex-1 sm:max-w-[280px]"}>
          <Input
            aria-label="Vendor name filter"
            placeholder="Search vendor / paid to"
            list="small-expense-vendor-suggestions"
            value={vendorFilter}
            onChange={e=>{setVendorFilter(e.target.value);setPage(0);}}
          />
          <datalist id="small-expense-vendor-suggestions">
            {vendorSuggestions.map(name=><option key={name} value={name}/>)}
          </datalist>
        </div>
        <div className={isSiteEngineer?"min-w-0 md:w-auto":"contents"}>
          {isSiteEngineer&&<label htmlFor="small-expense-filter-from" className="mb-1 block text-xs font-medium md:sr-only">From date</label>}
          <Input id="small-expense-filter-from" aria-label="From date" className={isSiteEngineer?"min-h-11 w-full md:w-auto":undefined} type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(0);}}/>
        </div>
        <div className={isSiteEngineer?"min-w-0 md:w-auto":"contents"}>
          {isSiteEngineer&&<label htmlFor="small-expense-filter-to" className="mb-1 block text-xs font-medium md:sr-only">To date</label>}
          <Input id="small-expense-filter-to" aria-label="To date" className={isSiteEngineer?"min-h-11 w-full md:w-auto":undefined} type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(0);}}/>
        </div>
        {isSiteEngineer&&<Button type="button" variant="ghost" className="min-h-11 md:hidden" onClick={clearFilters}>
          Clear filters
        </Button>}
      </div>
      {isSiteEngineer&&<details className="mb-4 rounded-xl border bg-card px-4 py-3 md:hidden">
        <summary className="cursor-pointer text-sm font-medium">Expense breakdown by category and project</summary>
        <div className="mt-4 grid gap-4 border-t pt-4 text-sm">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categories</h3>
            <div className="space-y-2">
              {[...total.byCategory.entries()].sort((a,b)=>b[1]-a[1]).map(([category,amount])=>
                <div key={category} className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words">{optionLabel(category,SMALL_EXPENSE_CATEGORIES)}</span>
                  <strong className="shrink-0 tabular-nums">{inr(amount)}</strong>
                </div>)}
              {!total.byCategory.size&&<p className="text-muted-foreground">No expenses match these filters.</p>}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projects</h3>
            <div className="space-y-2">
              {[...total.byProject.entries()].sort((a,b)=>b[1]-a[1]).map(([id,amount])=>
                <div key={id} className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words">{id==="office"?"General office":all.find(x=>x.project_id===id)?.projects?.name??"Project"}</span>
                  <strong className="shrink-0 tabular-nums">{inr(amount)}</strong>
                </div>)}
              {!total.byProject.size&&<p className="text-muted-foreground">No expenses match these filters.</p>}
            </div>
          </section>
        </div>
      </details>}
      <div className={isSiteEngineer?"mb-3 hidden gap-3 md:grid md:grid-cols-2":"mb-3 grid gap-3 md:grid-cols-2"}>
        <div className="rounded-xl border bg-card p-4"><h3 className="text-sm font-semibold">Category totals</h3>
          <div className="mt-3 space-y-2 text-sm">{[...total.byCategory.entries()].sort((a,b)=>b[1]-a[1]).map(([category,amount])=>
            <div key={category} className="flex justify-between gap-3"><span>{optionLabel(category,SMALL_EXPENSE_CATEGORIES)}</span><strong>{inr(amount)}</strong></div>)}
            {!total.byCategory.size&&<p className="text-xs text-muted-foreground">No recorded expenses in these filters.</p>}</div></div>
        <div className="rounded-xl border bg-card p-4"><h3 className="text-sm font-semibold">Project totals</h3>
          <div className="mt-3 space-y-2 text-sm">{[...total.byProject.entries()].sort((a,b)=>b[1]-a[1]).map(([id,amount])=>
            <div key={id} className="flex justify-between gap-3"><span>{id==="office"?"General office":all.find(x=>x.project_id===id)?.projects?.name??"Project"}</span><strong>{inr(amount)}</strong></div>)}
            {!total.byProject.size&&<p className="text-xs text-muted-foreground">No recorded expenses in these filters.</p>}</div>
          {!!total.byBuilding.size&&<>
            <h3 className="mb-2 mt-5 border-t pt-4 text-sm font-semibold">Building expenses</h3>
            <div className="space-y-2 text-sm">{[...total.byBuilding.entries()].sort((a,b)=>b[1]-a[1]).map(([id,amount])=>{
              const record=all.find(x=>x.building_id===id);
              return <div key={id} className="flex justify-between gap-3">
                <span>{record?.projects?.name??"Project"} / {record?.buildings?.name??"Building"}</span>
                <strong>{inr(amount)}</strong>
              </div>;
            })}</div>
          </>}
        </div>
      </div>
      {isSiteEngineer&&<section aria-label="My expense records" className="mb-3 space-y-3 md:hidden">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">My expenses</h3>
          <span className="text-xs text-muted-foreground">{rows.length} results</span>
        </div>
        {pageRows.map(x=>
          <article key={x.id} className="min-w-0 overflow-hidden rounded-2xl border bg-card p-4 shadow-card">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0"/>{fmtDate(x.spent_on)}
                </p>
                <h4 className="mt-2 break-words text-base font-semibold leading-snug [overflow-wrap:anywhere]">{x.paid_to}</h4>
                <p className="mt-1 break-words text-xs text-muted-foreground">{optionLabel(x.category,SMALL_EXPENSE_CATEGORIES)}{x.category==="other"&&x.other_category_detail?" · "+x.other_category_detail:""}</p>
              </div>
              <p className="max-w-[52%] shrink-0 break-words text-right text-lg font-bold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]">{inr(x.amount)}</p>
            </div>
            <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{x.description}</p>
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5">
                <Building2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0"/>
                <span className="min-w-0 break-words">{x.projects?.name??"General office"}{x.buildings?.name?" / "+x.buildings.name:""}</span>
              </span>
              <span className="rounded-md bg-muted px-2 py-1">{optionLabel(x.payment_method,SMALL_EXPENSE_PAYMENTS)}</span>
              {x.receipt_reference&&<span className="break-all">Ref: {x.receipt_reference}</span>}
            </div>
            <Button type="button" variant="outline"
              className="mt-3 min-h-11 w-full justify-between"
              onClick={()=>setViewing(x as SmallExpenseRecord)}>
              View expense <ChevronRight aria-hidden="true" className="h-4 w-4"/>
            </Button>
          </article>)}
        {!rows.length&&<div className="rounded-2xl border border-dashed bg-muted/20 px-5 py-12 text-center">
          <ReceiptText aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-muted-foreground"/>
          <p className="text-sm font-semibold">No expenses found</p>
          <p className="mt-1 text-xs text-muted-foreground">Record your first expense, or clear the filters.</p>
        </div>}
      </section>}
      <div className={isSiteEngineer?"doc-table hidden overflow-x-auto rounded-xl border bg-card shadow-card md:block":"doc-table overflow-x-auto rounded-xl border bg-card shadow-card"}>
        <table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b bg-muted/30 text-xs"><tr>
          <th className="p-3">Date</th><th className="p-3">Project / building</th><th className="p-3">Category</th>
          <th className="p-3">Paid to / purpose</th><th className="p-3">Method</th><th className="p-3">Receipt</th>
          <th className="p-3 text-right">Amount</th><th className="p-3">Actions</th>
        </tr></thead><tbody>{pageRows.map(x=><tr key={x.id} className="border-b last:border-0">
          <td className="p-3">{fmtDate(x.spent_on)}</td>
          <td className="p-3">{x.projects?.name??"Office"}{x.buildings?.name?" / "+x.buildings.name:""}</td>
          <td className="p-3">
            <span>{optionLabel(x.category,SMALL_EXPENSE_CATEGORIES)}</span>
            {x.category==="other"&&x.other_category_detail&&
              <span className="mt-0.5 block max-w-[180px] break-words text-xs text-muted-foreground">
                {x.other_category_detail}
              </span>}
          </td>
          <td className="p-3"><span className="font-medium">{x.paid_to}</span><p className="max-w-[260px] whitespace-normal text-xs text-muted-foreground">{x.description}</p></td>
          <td className="p-3">{optionLabel(x.payment_method,SMALL_EXPENSE_PAYMENTS)}</td>
          <td className="p-3">{x.receipt_reference??"—"}</td>
          <td className="p-3 text-right font-medium tabular-nums">{inr(x.amount)}</td>
          <td className="p-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={()=>setViewing(x as SmallExpenseRecord)}>View</Button>
              {canEdit&&<Button size="sm" variant="outline" onClick={()=>beginCorrection(x)}>Edit</Button>}
              {canDelete&&<PermanentDelete labelled force kind="small_expense" id={x.id}
                name={x.paid_to??"expense"} onDeleted={()=>void qc.invalidateQueries({queryKey:["small-expenses"]})}/>}
            </div>
          </td>
        </tr>)}
          {!rows.length&&<tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No small-expense entries match.</td></tr>}
        </tbody></table>
      </div>
      <Pager page={filteredPage} size={PAGE} total={rows.length} onPage={setPage}/>
      <div className="mt-3 text-xs text-muted-foreground">Small-expense totals are paid outgoings, separate from warehouse stock and approved vendor bills. <Link to="/inventory/material-consumption" className="text-primary underline">View material consumption</Link>.</div>
    </>}
    <SmallExpenseDetail expense={viewing} onClose={()=>setViewing(null)}/>
    <Dialog open={open} onOpenChange={value=>{if(!save.isPending)setOpen(value);}}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{editingId?"Edit existing expense":"Record a small expense"}</DialogTitle><DialogDescription>
          {editingId
            ?"Save changes to this same expense. No replacement entry and no void. Previous values remain in the audit history."
            :"Record an actual payment and attach up to 8 bill images or PDFs."}
        </DialogDescription></DialogHeader>
        {context.error&&<p role="alert" className="text-sm text-destructive">Could not verify your assigned projects. No expense can be recorded until access is restored. {errMsg(context.error)}</p>}
        {isSiteEngineer&&context.isSuccess&&!context.data.projects.length&&
          <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">
            No projects are assigned to your account. Ask your administrator to assign your site before recording expenses.
          </p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="text-sm font-medium">Date *</label><Input type="date" max={todayIst()} value={form.spentOn} onChange={e=>setField("spentOn",e.target.value)}/></div>
          <div><label className="text-sm font-medium">Amount (₹) *</label><Input inputMode="decimal" placeholder="e.g. 75000.00" value={form.amount} onChange={e=>setField("amount",e.target.value)} /></div>
          <div>
            <label className="text-sm font-medium" htmlFor="small-expense-category">Category *</label>
            <select id="small-expense-category" className={selectCls} value={form.category}
              onChange={e=>setForm(previous=>({
                ...previous,
                category:e.target.value as SmallExpenseCategory,
                otherCategoryDetail:e.target.value==="other" ? previous.otherCategoryDetail : "",
              }))}>
              {Object.entries(SMALL_EXPENSE_CATEGORIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {form.category==="other"&&
            <div>
              <label className="text-sm font-medium" htmlFor="small-expense-other-category">
                Specify category <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input id="small-expense-other-category" maxLength={120}
                placeholder="e.g. Pest control, equipment hire"
                value={form.otherCategoryDetail}
                onChange={e=>setField("otherCategoryDetail",e.target.value)}/>
              <p className="mt-1 text-xs text-muted-foreground">
                This label will appear with Other in the expense register.
              </p>
            </div>
          }
          <div><label className="text-sm font-medium">Paid through *</label><select className={selectCls} value={form.method} onChange={e=>setField("method",e.target.value as SmallExpensePayment)}>
            {Object.entries(SMALL_EXPENSE_PAYMENTS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="text-sm font-medium">Project {isSiteEngineer?"*":""}</label><select className={selectCls} value={form.projectId} onChange={e=>{setForm(v=>({...v,projectId:e.target.value,buildingId:""}));}}>
            <option value="">{isSiteEngineer?"Choose assigned project":"General office / no project"}</option>{context.data?.projects.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div><label className="text-sm font-medium">Building / wing</label><select className={selectCls} disabled={!form.projectId} value={form.buildingId} onChange={e=>setField("buildingId",e.target.value)}>
            <option value="">General project expense</option>{context.data?.buildings.filter(x=>x.project_id===form.projectId).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div><label className="text-sm font-medium">Paid to *</label><Input maxLength={120} placeholder="Shop / worker / service provider" value={form.paidTo} onChange={e=>setField("paidTo",e.target.value)}/></div>
          <div><label className="text-sm font-medium">Receipt / bill reference</label><Input maxLength={120} placeholder="Optional receipt number" value={form.reference} onChange={e=>setField("reference",e.target.value)}/></div>
          <div className="sm:col-span-2"><label className="text-sm font-medium">What was paid for? *</label><Textarea rows={3} maxLength={500} placeholder="Purpose and site details" value={form.description} onChange={e=>setField("description",e.target.value)}/></div>
        </div>
        <section className="mt-4 rounded-xl border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="h-4 w-4"/>Bill images / invoice photos / PDFs
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Add JPG, PNG, WebP or PDF receipts (10 MB each, up to 8 per expense).
            Only authorized reviewers and the original Site Engineer can open these private bills.
          </p>
          {editingId&&editBills.isLoading&&<p className="mt-2 text-xs">Loading existing bills…</p>}
          {editingId&&editBills.error&&<p role="alert" className="text-xs text-destructive">{errMsg(editBills.error)}</p>}
          {!!editingId&&!!editBills.data?.length&&
            <div className="mt-2 space-y-2">
              {editBills.data.map(b=>(
                <label key={b.id} className="flex items-center gap-2 rounded-md border bg-card p-2 text-xs">
                  <input type="checkbox" checked={removedBillPaths.includes(b.storage_path)}
                    onChange={e=>setRemovedBillPaths(current=>e.target.checked
                      ?[...current,b.storage_path]:current.filter(path=>path!==b.storage_path))}/>
                  <span className="min-w-0 flex-1 truncate">{b.file_name}</span>
                  <span className="text-muted-foreground">{removedBillPaths.includes(b.storage_path)?"Remove on save":"Keep"}</span>
                </label>
              ))}
            </div>}
          <input type="file" multiple accept={SMALL_EXPENSE_BILL_ACCEPT}
            aria-label="Attach bill photos or PDFs"
            className="mt-3 block w-full min-w-0 text-xs file:mr-3 file:rounded file:border file:bg-background file:px-3 file:py-2"
            onChange={e=>{
              addBillFiles(Array.from(e.target.files??[]));
              e.target.value="";
            }}/>
          {!!newBills.length&&<ul className="mt-3 space-y-1">
            {newBills.map((f,i)=><li key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{f.name} · {Math.ceil(f.size/1024)} KB</span>
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove selected ${f.name}`}
                onClick={()=>setNewBills(v=>v.filter((_,j)=>j!==i))}>
                <X className="h-4 w-4"/>
              </Button>
            </li>)}
          </ul>}
        </section>
        {editingId&&<div className="mt-3">
          <label className="text-sm font-medium" htmlFor="small-expense-correction-reason">Edit note (optional)</label>
          <Textarea id="small-expense-correction-reason" rows={2} maxLength={400}
            placeholder="What was changed? The previous values are saved automatically."
            value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)}/>
        </div>}
        <DialogFooter><Button variant="outline" onClick={()=>setOpen(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={()=>save.mutate()} disabled={save.isPending||context.isLoading||!!context.error||
            (isSiteEngineer&&!form.projectId)||
            (!!editingId&&(editBills.isLoading||!!editBills.error))}>
            <ReceiptText className="mr-1 h-4 w-4"/>{save.isPending?"Saving…":editingId?"Save changes":"Record paid expense"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
