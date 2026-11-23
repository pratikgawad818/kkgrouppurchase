import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, Eye, EyeOff, Plus, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCan, useMe } from "@/lib/session";
import { errMsg } from "@/lib/format";
import { PageHeader, Loading } from "@/components/erp/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/_shell/settings/bank-accounts")({
  head: () => ({ meta: [{ title: "Company Bank Accounts — KK GROUP ERP" }] }),
  component: BankAccounts,
});

type BankAccount = {
  id: string;
  company_id: string;
  account_name: string;
  account_holder_name: string | null;
  bank_name: string;
  branch: string | null;
  account_number: string;
  ifsc: string;
  account_type: string;
  purpose: string | null;
  is_primary: boolean;
  status: "active" | "inactive";
  legal_entity_id: string | null;
};
type Entity = { id: string; company_id: string; display_name: string; legal_name: string | null; is_active: boolean };
type BankForm = {
  account_name: string; account_holder_name: string; bank_name: string;
  branch: string; account_number: string; ifsc: string; account_type: string;
  purpose: string; is_primary: boolean; status: "active" | "inactive";
  legal_entity_id: string;
};
const empty: BankForm = {
  account_name: "", account_holder_name: "", bank_name: "", branch: "",
  account_number: "", ifsc: "", account_type: "current",
  purpose: "", is_primary: false, status: "active", legal_entity_id: "",
};
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const mask = (number: string) => number.length > 4
  ? `••••••${number.slice(-4)}` : "••••";
const optional = (value: string) => value.trim() || null;
const selectStyle = "min-h-10 w-full rounded-md border bg-background px-3 text-sm";

// Temporary compatibility shim until the generated Supabase schema includes
// migration 0116's new legal_entity_id and account_holder_name columns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bankDb = supabase as any;

function BankAccounts() {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const allowed = can("company.bank.manage") &&
    !!me.data?.roles.some(role => role === "super_admin" || role === "accounts_manager");
  const companyId = me.data?.profile.company_id ?? "";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [form, setForm] = useState<BankForm>(empty);
  const accounts = useQuery({
    queryKey: ["bank-accounts-master", companyId],
    enabled: allowed && !!companyId,
    queryFn: async (): Promise<BankAccount[]> => {
      const { data, error } = await bankDb.from("company_bank_accounts")
        .select("id,company_id,account_name,account_holder_name,bank_name,branch,account_number,ifsc,account_type,purpose,is_primary,status,legal_entity_id")
        .eq("company_id", companyId).order("account_name");
      if (error) throw error;
      return (data ?? []) as BankAccount[];
    },
  });
  const entities = useQuery({
    queryKey: ["bank-legal-entities", companyId],
    enabled: allowed && !!companyId,
    queryFn: async (): Promise<Entity[]> => {
      const { data, error } = await bankDb.from("legal_entities")
        .select("id,company_id,display_name,legal_name,is_active")
        .eq("company_id", companyId).order("display_name");
      if (error) throw error;
      return (data ?? []) as Entity[];
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!allowed || !companyId) throw new Error("Bank changes are restricted to Super Admin and Accounts Manager.");
      const account = form.account_number.trim();
      const ifsc = form.ifsc.trim().toUpperCase();
      if (form.account_name.trim().length < 2 || form.bank_name.trim().length < 2 ||
          form.account_holder_name.trim().length < 2)
        throw new Error("Enter an account label, bank name and legal account holder.");
      if (!/^[0-9]{6,25}$/.test(account))
        throw new Error("The account number must contain 6–25 digits.");
      if (!IFSC.test(ifsc)) throw new Error("Enter a valid 11-character IFSC.");
      if (form.legal_entity_id && !entities.data?.some(e => e.id === form.legal_entity_id))
        throw new Error("Select a valid legal entity belonging to the company.");
      const payload = {
        account_name: form.account_name.trim(),
        account_holder_name: form.account_holder_name.trim(),
        bank_name: form.bank_name.trim(),
        branch: optional(form.branch),
        account_number: account,
        ifsc,
        account_type: form.account_type,
        purpose: optional(form.purpose),
        is_primary: form.is_primary,
        status: form.status,
        legal_entity_id: form.legal_entity_id || null,
      };
      const result = editingId
        ? await bankDb.from("company_bank_accounts").update(payload)
            .eq("id", editingId).eq("company_id", companyId).select("id").single()
        : await bankDb.from("company_bank_accounts")
            .insert({ ...payload, company_id: companyId }).select("id").single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("No bank account was saved. Check permissions.");
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["bank-accounts-master", companyId] }),
        qc.invalidateQueries({ queryKey: ["payment-base"] }),
        qc.invalidateQueries({ queryKey: ["bank-legal-entities", companyId] }),
      ]);
      setEditorOpen(false);
      setReveal(false);
      toast.success("Bank details saved. Existing payments were not changed.");
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  const addAccount = () => {
    setEditingId(null); setForm({ ...empty }); setReveal(false); setEditorOpen(true);
  };
  const editAccount = (account: BankAccount) => {
    setEditingId(account.id);
    setForm({
      account_name: account.account_name,
      account_holder_name: account.account_holder_name ?? "",
      bank_name: account.bank_name,
      branch: account.branch ?? "",
      account_number: account.account_number,
      ifsc: account.ifsc,
      account_type: account.account_type,
      purpose: account.purpose ?? "",
      is_primary: account.is_primary,
      status: account.status,
      legal_entity_id: account.legal_entity_id ?? "",
    });
    setReveal(false); setEditorOpen(true);
  };
  const set = (key: keyof BankForm, value: string | boolean) =>
    setForm(current => ({ ...current, [key]: value }));

  if (me.isLoading) return <Loading />;
  if (!allowed) return <p role="alert" className="rounded-lg border p-4 text-sm">
    Only Super Admin and Accounts Manager can manage company bank accounts.
  </p>;
  return (
    <>
      <PageHeader title="Company Bank Accounts"
        subtitle="Maintain bank identity and link accounts to the correct purchasing entity. Historical payment references stay intact."
        actions={<Button size="sm" onClick={addAccount}><Plus className="mr-2 h-4 w-4"/>Add bank account</Button>} />
      <p className="mb-4 rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <ShieldCheck className="mr-2 inline h-4 w-4" />
        Editing a bank account does not rewrite completed payments. Keep old accounts inactive instead of deleting them. Verify legal-entity ownership before selecting the account for a payment.
      </p>
      {accounts.error && <p role="alert" className="rounded-lg border border-destructive p-4 text-sm">
        Unable to load bank accounts: {errMsg(accounts.error)}
      </p>}
      {entities.error && <p role="alert" className="rounded-lg border border-destructive p-4 text-sm">
        Unable to load legal entities: {errMsg(entities.error)}
      </p>}
      {accounts.isLoading ? <Loading /> : <div className="grid gap-3 lg:grid-cols-2">
        {(accounts.data ?? []).map(a => {
          const entity = entities.data?.find(e => e.id === a.legal_entity_id);
          return <section className="rounded-xl border bg-card p-4" key={a.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">{a.account_name}</h2>
                <p className="text-sm text-muted-foreground">{a.bank_name}{a.branch ? ` · ${a.branch}` : ""}</p>
              </div>
              <span className="rounded-full border px-2 py-1 text-xs">{a.status === "active" ? "Active" : "Inactive"}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div><dt className="text-xs text-muted-foreground">Account holder</dt>
                <dd className="break-words">{a.account_holder_name || "Not yet recorded"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Account number</dt>
                <dd className="font-mono">{mask(a.account_number)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">IFSC</dt><dd className="font-mono">{a.ifsc}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Type</dt><dd className="capitalize">{a.account_type}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-muted-foreground">Legal entity / GST owner</dt>
                <dd>{entity?.legal_name || entity?.display_name || "Not assigned — verify before use"}</dd></div>
            </dl>
            <Button className="mt-4" variant="outline" size="sm" onClick={() => editAccount(a)}>
              Edit account details
            </Button>
          </section>;
        })}
        {!accounts.error && accounts.data?.length === 0 && <p className="rounded-lg border p-5 text-sm text-muted-foreground">No company bank accounts. Add one to begin.</p>}
      </div>}
      {editorOpen && <form className="mt-5 space-y-4 rounded-xl border bg-card p-4 sm:p-6"
        onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4"/>{editingId ? "Edit company bank account" : "New company bank account"}</h2>
          <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)}>Close</Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div><Label htmlFor="bank-label">Display name *</Label>
            <Input id="bank-label" required maxLength={120} value={form.account_name}
              onChange={e => set("account_name",e.target.value)} placeholder="Operating account" /></div>
          <div><Label htmlFor="bank-holder">Legal account holder *</Label>
            <Input id="bank-holder" required maxLength={160} value={form.account_holder_name}
              onChange={e => set("account_holder_name",e.target.value)} placeholder="Name as per bank record" /></div>
          <div><Label htmlFor="bank-name">Bank name *</Label>
            <Input id="bank-name" required value={form.bank_name}
              onChange={e => set("bank_name",e.target.value)} /></div>
          <div><Label htmlFor="bank-branch">Branch</Label>
            <Input id="bank-branch" value={form.branch} onChange={e => set("branch",e.target.value)} /></div>
          <div><Label htmlFor="bank-number">Account number *</Label>
            <div className="flex gap-2">
              <Input id="bank-number" required type={reveal ? "text" : "password"}
                inputMode="numeric" autoComplete="off" value={form.account_number}
                onChange={e => set("account_number",e.target.value.replace(/\s/g,""))} />
              <Button type="button" size="icon" variant="outline" onClick={() => setReveal(x => !x)}
                aria-label={reveal ? "Hide bank number" : "Show bank number"}>{reveal ? <EyeOff/> : <Eye/>}</Button>
            </div></div>
          <div><Label htmlFor="bank-ifsc">IFSC *</Label>
            <Input id="bank-ifsc" required maxLength={11} autoCapitalize="characters"
              value={form.ifsc} onChange={e => set("ifsc",e.target.value.toUpperCase())} /></div>
          <div><Label htmlFor="bank-type">Account type</Label>
            <select id="bank-type" className={selectStyle} value={form.account_type}
              onChange={e => set("account_type",e.target.value)}>
              <option value="current">Current</option><option value="savings">Savings</option>
              <option value="od">Overdraft (OD)</option><option value="cc">Cash credit (CC)</option>
            </select></div>
          <div><Label htmlFor="bank-entity">Legal entity / registered buyer</Label>
            <select id="bank-entity" className={selectStyle} value={form.legal_entity_id}
              onChange={e => set("legal_entity_id",e.target.value)}>
              <option value="">Not assigned — verify later</option>
              {(entities.data ?? []).map(e => <option value={e.id} key={e.id}>
                {e.legal_name || e.display_name}{e.is_active ? "" : " (inactive)"}
              </option>)}
            </select></div>
          <div><Label htmlFor="bank-purpose">Purpose / notes</Label>
            <Input id="bank-purpose" value={form.purpose} onChange={e => set("purpose",e.target.value)}/></div>
          <div><Label htmlFor="bank-status">Status</Label>
            <select id="bank-status" className={selectStyle} value={form.status}
              onChange={e => set("status",e.target.value)}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </select></div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_primary}
            onChange={e => set("is_primary",e.target.checked)}/> Mark as primary account
        </label>
        <Button type="submit" disabled={save.isPending}><Save className="mr-2 h-4 w-4"/>
          {save.isPending ? "Saving…" : "Save bank account"}</Button>
      </form>}
    </>
  );
}
