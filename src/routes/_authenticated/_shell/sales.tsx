import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Building2, CreditCard, Home, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { loadCompleteRows } from "@/lib/complete-register";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader, Loading } from "@/components/erp/common";
import { UNIT_TYPE_LABEL } from "@/lib/format";

// The sales tables and RPCs are created in migration 0085.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type Project = { id: string; name: string };
type Building = { id: string; project_id: string; name: string };
type Floor = { id: string; building_id: string; name: string; floor_number: number };
type Flat = {
  id: string; project_id: string; building_id: string; floor_id: string;
  unit_number: string; unit_type: string; saleable_area: number; carpet_area: number;
  status: string; base_rate: number; total_agreement_value: number;
};
type Sale = {
  id: string; sale_number: string; unit_id: string; project_id: string;
  buyer_name: string; buyer_mobile: string; final_sale_price: number;
  status: string; booked_on: string;
};
type Receipt = {
  id: string; sale_id: string; amount: number; paid_on: string;
  method: string; reference: string | null; status: string; reviewer_note: string | null;
};
type Data = {
  projects: Project[]; buildings: Building[]; floors: Floor[];
  flats: Flat[]; sales: Sale[]; receipts: Receipt[];
};
const input = "h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm";
const formatMoney = (value: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(Number(value) || 0);
const n = (value: unknown) => Number(value) || 0;
const today = () => new Date().toLocaleDateString("en-CA");
const labels: Record<string, string> = {
  available: "Available", hold: "On hold", booked: "Booked",
  agreement_pending: "Agreement pending", agreement_done: "Agreement done",
  registered: "Registered", possession_pending: "Possession pending",
  possession_completed: "Possession completed", cancelled: "Cancelled",
};
const stages = ["booked", "agreement_pending", "agreement_done", "registered",
  "possession_pending", "possession_completed"];
const methods = ["upi", "neft", "rtgs", "imps", "cheque", "cash", "card", "other"];

async function all<T extends { id: string }>(table: string, columns: string): Promise<T[]> {
  return loadCompleteRows<T>(async (start, end) => {
    const result = await db.from(table).select(columns, { count: "exact" })
      .order("id").range(start, end);
    return {
      data: result.data as T[] | null,
      count: result.count as number | null,
      error: result.error as { message: string } | null,
    };
  });
}
async function loadData(): Promise<Data> {
  const [projects, buildings, floors, flats, sales, receipts] = await Promise.all([
    all<Project>("projects", "id,name"),
    all<Building>("buildings", "id,project_id,name"),
    all<Floor>("floors", "id,building_id,name,floor_number"),
    all<Flat>("units", "id,project_id,building_id,floor_id,unit_number,unit_type,saleable_area,carpet_area,status,base_rate,total_agreement_value"),
    all<Sale>("property_sales", "id,sale_number,unit_id,project_id,buyer_name,buyer_mobile,final_sale_price,status,booked_on"),
    all<Receipt>("property_sale_receipts", "id,sale_id,amount,paid_on,method,reference,status,reviewer_note"),
  ]);
  return { projects, buildings, floors, flats, sales, receipts };
}
async function call(name: string, args: Record<string, unknown>) {
  const result = await db.rpc(name, args);
  if (result.error) throw result.error;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-xs font-semibold text-muted-foreground">
    <span>{label}</span>{children}
  </label>;
}
function Status({ text }: { text: string }) {
  return <span className="inline-flex rounded-lg border bg-muted/50 px-2 py-1 text-[11px] font-medium">
    {labels[text] ?? text}
  </span>;
}

export const Route = createFileRoute("/_authenticated/_shell/sales")({
  head: () => ({ meta: [{ title: "Sales & Bookings — KK GROUP ERP" }] }),
  component: SalesPage,
});

function SalesPage() {
  const me = useMe();
  const qc = useQueryClient();
  const manager = !!me.data?.roles.some(role => role === "super_admin" || role === "director");
  const q = useQuery({
    queryKey: ["real-estate-sales", me.data?.profile.id],
    queryFn: loadData,
    enabled: !!me.data?.profile.id,
  });
  const [tab, setTab] = useState<"inventory" | "sales" | "receipts">("inventory");
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"flat" | "book" | "receipt" | "stage" | null>(null);
  const [flat, setFlat] = useState<Flat | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const value = (key: string) => form[key] ?? "";
  const put = (key: string, next: string) => setForm(current => ({ ...current, [key]: next }));
  const update = async (name: string, args: Record<string, unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await call(name, args);
      toast.success(message);
      setModal(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["real-estate-sales"] }),
        qc.invalidateQueries({ queryKey: ["units"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const data = q.data;
  const projectNames = useMemo(() => new Map(data?.projects.map(x => [x.id, x.name])), [data]);
  const buildingNames = useMemo(() => new Map(data?.buildings.map(x => [x.id, x.name])), [data]);
  const flatsById = useMemo(() => new Map(data?.flats.map(x => [x.id, x])), [data]);
  const payments = useMemo(() => {
    const result = new Map<string, { verified: number; reported: number }>();
    for (const receipt of data?.receipts ?? []) {
      const row = result.get(receipt.sale_id) ?? { verified: 0, reported: 0 };
      if (receipt.status === "verified") row.verified += n(receipt.amount);
      if (receipt.status === "reported") row.reported += n(receipt.amount);
      result.set(receipt.sale_id, row);
    }
    return result;
  }, [data]);
  const allFlats = (data?.flats ?? []).filter(item => !project || item.project_id === project);
  const flats = allFlats.filter(item => !search ||
    [item.unit_number, buildingNames.get(item.building_id) ?? ""].some(x =>
      x.toLowerCase().includes(search.toLowerCase())));
  const allSales = (data?.sales ?? []).filter(item => !project || item.project_id === project);
  const sales = allSales.filter(item => !search ||
    [item.buyer_name, item.buyer_mobile, item.sale_number,
      flatsById.get(item.unit_id)?.unit_number ?? ""].some(x =>
        x.toLowerCase().includes(search.toLowerCase())));
  const activeSales = allSales.filter(item => item.status !== "cancelled");
  const collected = activeSales.reduce((total, s) => total + (payments.get(s.id)?.verified ?? 0), 0);
  const outstanding = activeSales.reduce((total, s) =>
    total + Math.max(0, n(s.final_sale_price) - (payments.get(s.id)?.verified ?? 0)), 0);
  const selectedBuildings = (data?.buildings ?? []).filter(b => b.project_id === value("project_id"));
  const selectedFloors = (data?.floors ?? []).filter(f => f.building_id === value("building_id"));
  const selectedSale = sale ? (payments.get(sale.id) ?? { verified: 0, reported: 0 }) : null;

  function openFlat() {
    setForm({ project_id: project, building_id: "", floor_id: "",
      type: "2bhk", parking: "0", other: "0", gst: "5" });
    setModal("flat");
  }
  function openBooking(item: Flat) {
    setFlat(item);
    setForm({ price: String(item.total_agreement_value), booked_on: today() });
    setModal("book");
  }
  function openReceipt(item: Sale) {
    setSale(item);
    setForm({ method: "upi", paid_on: today() });
    setModal("receipt");
  }
  function openStage(item: Sale) {
    setSale(item);
    setForm({});
    setModal("stage");
  }
  const record = (event: FormEvent<HTMLFormElement>, name: string,
    args: Record<string, unknown>, success: string) => {
    event.preventDefault();
    void update(name, args, success);
  };
  const receipts = (data?.receipts ?? []).filter(r => {
    const parent = data?.sales.find(s => s.id === r.sale_id);
    return !!parent && (!project || parent.project_id === project) &&
      (!search || parent.buyer_name.toLowerCase().includes(search.toLowerCase()) ||
        (r.reference ?? "").toLowerCase().includes(search.toLowerCase()));
  });

  return <div className="min-w-0 space-y-5 pb-10">
    <PageHeader title="Sales" subtitle="Flat inventory, buyer bookings and verified customer collections" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {([
        ["Available flats", String(allFlats.filter(x => x.status === "available").length), Home],
        ["Active bookings", String(activeSales.length), Building2],
        ["Verified paid", formatMoney(collected), CreditCard],
        ["Outstanding", formatMoney(outstanding), Wallet],
      ] as const).map(([label, stat, Icon]) =>
        <section key={label} className="min-w-0 rounded-xl border bg-card p-3.5 sm:p-5">
          <Icon className="mb-2 h-4 w-4 text-primary" aria-hidden="true" />
          <p className="break-words text-lg font-bold tabular-nums sm:text-2xl">{stat}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </section>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <select className={input + " max-w-60"} aria-label="Select sales project" value={project}
        onChange={e => setProject(e.target.value)}>
        <option value="">All accessible projects</option>
        {data?.projects.map(item =>
          <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <input className={input + " min-w-40 flex-1"} aria-label="Search sales records"
        placeholder="Search flat or buyer" value={search} onChange={e => setSearch(e.target.value)} />
      {manager && <Button className="h-11 gap-2" onClick={openFlat}>
        <Plus className="h-4 w-4" />Add flat</Button>}
    </div>
    <div role="tablist" aria-label="Sales sections" className="flex min-w-0 gap-1 overflow-x-auto rounded-xl bg-muted p-1">
      {([["inventory", "Flat inventory"], ["sales", "Bookings"], ["receipts", "Collections"]] as const)
        .map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key}
          type="button" onClick={() => setTab(key)}
          className={"min-h-10 shrink-0 rounded-lg px-4 text-sm font-medium " +
            (tab === key ? "bg-card shadow-sm" : "text-muted-foreground")}>
          {label}</button>)}
    </div>
    {q.isLoading && <Loading />}
    {q.isError && <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 p-4">
      <p className="text-sm text-destructive">Unable to load Sales: {q.error.message}</p>
      <Button variant="outline" onClick={() => void q.refetch()}>Retry</Button>
    </div>}
    {q.isSuccess && tab === "inventory" &&
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {flats.map(item => <article key={item.id} className="min-w-0 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold">Flat {item.unit_number}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {projectNames.get(item.project_id)} · {buildingNames.get(item.building_id)}
              </p>
            </div>
            <Status text={item.status} />
          </div>
          <p className="mt-4 text-xl font-bold tabular-nums">{formatMoney(n(item.total_agreement_value))}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {UNIT_TYPE_LABEL[item.unit_type as keyof typeof UNIT_TYPE_LABEL] ?? item.unit_type}
            {" · "}{item.saleable_area} sqft saleable
            {" · "}{formatMoney(n(item.base_rate))}/sqft
          </p>
          {item.status === "available" && <Button className="mt-4 h-10 w-full"
            onClick={() => openBooking(item)}>Book flat</Button>}
        </article>)}
        {!flats.length && <p className="col-span-full rounded-xl border bg-card p-8 text-sm text-muted-foreground">
          No flats found. {manager ? "Use Add flat to enter the project inventory once." :
            "Ask management to enter flats and assign you to the project."}
        </p>}
      </div>}
    {q.isSuccess && tab === "sales" && <div className="space-y-3">
      {sales.map(item => {
        const paid = payments.get(item.id) ?? { verified: 0, reported: 0 };
        const due = Math.max(0, n(item.final_sale_price) - paid.verified);
        return <article key={item.id} className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="break-words text-sm font-semibold">{item.buyer_name}
                {" · Flat "}{flatsById.get(item.unit_id)?.unit_number ?? "—"}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{item.sale_number} · {item.buyer_mobile}</p>
            </div>
            <Status text={item.status}/>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/35 p-3 sm:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">Sale price</p>
              <p className="mt-1 break-words text-sm font-semibold">{formatMoney(n(item.final_sale_price))}</p></div>
            <div><p className="text-xs text-muted-foreground">Verified paid</p>
              <p className="mt-1 break-words text-sm font-semibold">{formatMoney(paid.verified)}</p></div>
            <div><p className="text-xs text-muted-foreground">Balance due</p>
              <p className="mt-1 break-words text-sm font-semibold">{formatMoney(due)}</p></div>
          </div>
          {paid.reported > 0 && <p className="mt-2 text-xs text-amber-700">
            {formatMoney(paid.reported)} reported, awaiting verification (not deducted from balance).
          </p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {item.status !== "cancelled" && due > 0 && <Button size="sm"
              onClick={() => openReceipt(item)}>Record payment</Button>}
            {manager && !["cancelled", "possession_completed"].includes(item.status) &&
              <Button size="sm" variant="outline" onClick={() => openStage(item)}>Update stage</Button>}
          </div>
        </article>;
      })}
      {!sales.length && <p className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
        No bookings. Select an available flat under Flat inventory to begin.
      </p>}
    </div>}
    {q.isSuccess && tab === "receipts" && <div className="space-y-3">
      {receipts.map(receipt => {
        const buyer = data?.sales.find(x => x.id === receipt.sale_id);
        return <article key={receipt.id} className="min-w-0 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{buyer?.buyer_name} · {formatMoney(n(receipt.amount))}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {receipt.paid_on} · {receipt.method.toUpperCase()}
                {receipt.reference ? " · " + receipt.reference : ""}
              </p>
            </div>
            <Status text={receipt.status} />
          </div>
          {receipt.reviewer_note && <p className="mt-2 text-xs text-muted-foreground">
            Review: {receipt.reviewer_note}</p>}
          {manager && receipt.status === "reported" && <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy}
              onClick={() => void update("sales_review_receipt",
                { _receipt_id: receipt.id, _approve: true }, "Receipt verified")}>Verify receipt</Button>
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => {
                const reason = window.prompt("Reason for rejecting this payment:");
                if (reason?.trim()) void update("sales_review_receipt",
                  { _receipt_id: receipt.id, _approve: false, _note: reason }, "Receipt rejected");
              }}>Reject</Button>
          </div>}
        </article>;
      })}
      {!receipts.length && <p className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
        No customer payments recorded yet.
      </p>}
    </div>}
    <Dialog open={!!modal} onOpenChange={open => { if (!open && !busy) setModal(null); }}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{modal === "flat" ? "Add flat to Sales inventory" :
            modal === "book" ? "Book flat " + flat?.unit_number :
            modal === "receipt" ? "Record customer payment" : "Update sale stage"}</DialogTitle>
          <DialogDescription>{modal === "flat" ? "Enter this flat once. Sales and the inventory register share it." :
            modal === "book" ? "Booking makes this flat unavailable to other buyers." :
            modal === "receipt" ? "Reported payments count only after Director verification." :
            "Only Directors and Super Admins can advance or cancel sales."}</DialogDescription>
        </DialogHeader>
        {modal === "flat" && <form className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={e => record(e, "sales_add_flat", {
            _floor_id: value("floor_id"), _number: value("number").trim(), _type: value("type"),
            _carpet: Number(value("carpet")), _built_up: Number(value("built_up")),
            _saleable: Number(value("saleable")), _rate: Number(value("rate")),
            _parking: Number(value("parking")), _other: Number(value("other")),
            _gst: Number(value("gst")),
          }, "Flat added to shared inventory")}>
          <Field label="Project *"><select required className={input} value={value("project_id")}
            onChange={e => setForm(prev => ({
              ...prev, project_id: e.target.value, building_id: "", floor_id: "",
            }))}>
            <option value="">Select project</option>
            {data?.projects.map(x => <option value={x.id} key={x.id}>{x.name}</option>)}
          </select></Field>
          <Field label="Building / tower *"><select required className={input} value={value("building_id")}
            onChange={e => setForm(prev => ({ ...prev, building_id: e.target.value, floor_id: "" }))}>
            <option value="">Select building</option>
            {selectedBuildings.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></Field>
          <Field label="Floor *"><select required className={input} value={value("floor_id")}
            onChange={e => put("floor_id", e.target.value)}><option value="">Select floor</option>
            {selectedFloors.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></Field>
          <Field label="Flat number *"><input required maxLength={50} className={input}
            value={value("number")} onChange={e => put("number", e.target.value)}/></Field>
          <Field label="Flat type"><select className={input} value={value("type")}
            onChange={e => put("type", e.target.value)}>
            {Object.entries(UNIT_TYPE_LABEL).map(([k, v]) =>
              <option key={k} value={k}>{v}</option>)}
          </select></Field>
          {([
            ["carpet", "Carpet area (sqft)"], ["built_up", "Built-up area (sqft)"],
            ["saleable", "Saleable area (sqft)"], ["rate", "Rate (₹/sqft)"],
            ["parking", "Parking charges"], ["other", "Other charges"], ["gst", "GST %"],
          ] as const).map(([key, label]) =>
            <Field key={key} label={label}>
              <input className={input} type="number" step=".01" min="0"
                max={key === "gst" ? 28 : undefined}
                required={["carpet", "built_up", "saleable", "rate"].includes(key)}
                value={value(key)} onChange={e => put(key, e.target.value)}/>
            </Field>)}
          <Button className="h-11 sm:col-span-2" disabled={busy} type="submit">
            {busy ? "Saving…" : "Add flat"}</Button>
        </form>}
        {modal === "book" && flat && <form className="space-y-3"
          onSubmit={e => record(e, "sales_book_flat", {
            _unit_id: flat.id, _name: value("buyer_name"), _mobile: value("buyer_mobile"),
            _price: Number(value("price")), _booked_on: value("booked_on"),
            _email: value("buyer_email") || null, _co_buyer: value("co_buyer") || null,
            _notes: value("notes") || null,
          }, "Flat booked")}>
          <p className="rounded-lg bg-muted p-3 text-sm">
            Listed price: <strong>{formatMoney(n(flat.total_agreement_value))}</strong>
          </p>
          {([
            ["buyer_name", "Buyer full name", "text", true],
            ["buyer_mobile", "Mobile number", "tel", true],
            ["buyer_email", "Email (optional)", "email", false],
            ["co_buyer", "Co-buyer (optional)", "text", false],
            ["price", "Agreed final price (₹)", "number", true],
            ["booked_on", "Booking date", "date", true],
          ] as const).map(([key, label, type, required]) =>
            <Field key={key} label={label}>
              <input className={input} type={type} required={required}
                min={type === "number" ? 1 : undefined}
                step={type === "number" ? ".01" : undefined}
                max={type === "date" ? today() : undefined}
                value={value(key)} onChange={e => put(key, e.target.value)}/>
            </Field>)}
          <Field label="Notes"><textarea className={input + " min-h-20 py-2"}
            value={value("notes")} onChange={e => put("notes", e.target.value)}/></Field>
          <Button className="h-11 w-full" disabled={busy} type="submit">
            {busy ? "Booking…" : "Confirm booking"}</Button>
        </form>}
        {modal === "receipt" && sale && <form className="space-y-3"
          onSubmit={e => record(e, "sales_report_receipt", {
            _sale_id: sale.id, _amount: Number(value("amount")), _paid_on: value("paid_on"),
            _method: value("method"), _reference: value("reference") || null,
            _payer: value("payer") || null, _notes: value("notes") || null,
          }, "Payment reported for verification")}>
          <p className="rounded-lg bg-muted p-3 text-sm">Buyer: <strong>{sale.buyer_name}</strong>
            <span className="mt-1 block">Balance due: {formatMoney(Math.max(0,
              n(sale.final_sale_price) - (selectedSale?.verified ?? 0)))}</span></p>
          <Field label="Amount paid (₹) *"><input required className={input} type="number"
            min=".01" step=".01" value={value("amount")}
            onChange={e => put("amount", e.target.value)}/></Field>
          <Field label="Payment date *"><input required className={input} type="date" max={today()}
            value={value("paid_on")} onChange={e => put("paid_on", e.target.value)}/></Field>
          <Field label="Payment method *"><select className={input} value={value("method")}
            onChange={e => put("method", e.target.value)}>
            {methods.map(x => <option key={x} value={x}>{x.toUpperCase()}</option>)}
          </select></Field>
          <Field label="Transaction reference (required unless cash)"><input className={input}
            required={value("method") !== "cash"} value={value("reference")}
            onChange={e => put("reference", e.target.value)}/></Field>
          <Field label="Payer name"><input className={input} value={value("payer")}
            onChange={e => put("payer", e.target.value)}/></Field>
          <Field label="Notes"><textarea className={input + " min-h-20 py-2"}
            value={value("notes")} onChange={e => put("notes", e.target.value)}/></Field>
          <Button className="h-11 w-full" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Record for verification"}</Button>
        </form>}
        {modal === "stage" && sale && <div className="space-y-3">
          <p className="rounded-lg bg-muted p-3 text-sm">
            {sale.buyer_name} · {labels[sale.status] ?? sale.status}
          </p>
          {stages.indexOf(sale.status) >= 0 &&
            stages.indexOf(sale.status) < stages.length - 1 &&
            <Button className="h-11 w-full" disabled={busy} onClick={() =>
              void update("sales_set_stage", {
                _sale_id: sale.id, _status: stages[stages.indexOf(sale.status) + 1],
              }, "Sale progressed")}>Advance to {labels[stages[stages.indexOf(sale.status) + 1] ?? ""]}</Button>}
          <Field label="Cancellation reason"><textarea className={input + " min-h-20 py-2"}
            value={value("reason")} onChange={e => put("reason", e.target.value)}/></Field>
          <Button variant="destructive" className="h-11 w-full" disabled={busy || value("reason").trim().length < 5}
            onClick={() => void update("sales_set_stage", {
              _sale_id: sale.id, _status: "cancelled", _reason: value("reason"),
            }, "Sale cancelled")}>Cancel booking</Button>
        </div>}
      </DialogContent>
    </Dialog>
    <p className="text-xs leading-relaxed text-muted-foreground">
      Only verified customer receipts reduce the outstanding balance. The Sales and Flat Inventory
      pages share one unit master; no duplicate flats are created.
    </p>
  </div>;
}
