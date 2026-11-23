import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type BankForm = {
  bank_account_name: string;
  bank_name: string;
  bank_account_number: string;
  ifsc: string;
};
const blank: BankForm = {
  bank_account_name: "", bank_name: "", bank_account_number: "", ifsc: "",
};
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const empty = (value: string) => value.trim() || null;

/** Bank details can only be edited by Accounts Manager or Super Admin.
 * The database independently enforces these roles for UPDATEs, even if the
 * network request bypasses this screen. No bank data appears in vendor lists.
 */
export function VendorBankEditor({
  vendor, onClose,
}: {
  vendor: { id: string; company_name: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [showNumber, setShowNumber] = useState(false);
  const [form, setForm] = useState<BankForm>(blank);
  const details = useQuery({
    queryKey: ["vendor-bank-edit", vendor.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors")
        .select("bank_account_name,bank_name,bank_account_number,ifsc")
        .eq("id", vendor.id).single();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!details.data) return;
    setForm({
      bank_account_name: details.data.bank_account_name ?? "",
      bank_name: details.data.bank_name ?? "",
      bank_account_number: details.data.bank_account_number ?? "",
      ifsc: details.data.ifsc ?? "",
    });
  }, [details.data]);
  const save = useMutation({
    mutationFn: async () => {
      const number = form.bank_account_number.trim();
      const name = form.bank_account_name.trim();
      const bank = form.bank_name.trim();
      const ifsc = form.ifsc.trim().toUpperCase();
      if (number || name || bank || ifsc) {
        if (!/^[0-9]{6,25}$/.test(number))
          throw new Error("Enter a 6–25 digit bank account number.");
        if (name.length < 2 || bank.length < 2)
          throw new Error("Enter the bank name and legal account holder.");
        if (!IFSC.test(ifsc)) throw new Error("Enter a valid IFSC code.");
      }
      const { data, error } = await supabase.from("vendors").update({
        bank_account_name: empty(name),
        bank_name: empty(bank),
        bank_account_number: empty(number),
        ifsc: empty(ifsc),
      }).eq("id", vendor.id)
        .select("id").single();
      if (error) throw error;
      if (!data) throw new Error("Vendor bank details were not updated. Check permissions.");
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["vendor-bank-edit", vendor.id] });
      void qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Supplier bank details saved with audit history.");
      onClose();
    },
    onError: (error) => toast.error(errMsg(error)),
  });
  const update = (field: keyof BankForm, value: string) =>
    setForm(previous => ({ ...previous, [field]: value }));
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Supplier bank account · {vendor.company_name}</DialogTitle>
        <DialogDescription>
          Account changes are restricted to Super Admin and Accounts Manager.
          Existing vendor invoices and payment transactions are not rewritten.
        </DialogDescription>
      </DialogHeader>
      {details.error && <p role="alert" className="text-sm text-destructive">
        Failed to load supplier bank details: {errMsg(details.error)}
      </p>}
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <div>
          <Label htmlFor="vendor-account-holder">Account holder name</Label>
          <Input id="vendor-account-holder" value={form.bank_account_name}
            autoComplete="off" onChange={e => update("bank_account_name",e.target.value)}
            placeholder="Exact bank account holder" />
        </div>
        <div>
          <Label htmlFor="vendor-bank-name">Bank name</Label>
          <Input id="vendor-bank-name" value={form.bank_name}
            autoComplete="off" onChange={e => update("bank_name",e.target.value)} />
        </div>
        <div>
          <Label htmlFor="vendor-bank-number">Account number</Label>
          <div className="flex gap-2">
            <Input id="vendor-bank-number" type={showNumber ? "text" : "password"}
              inputMode="numeric" autoComplete="off" value={form.bank_account_number}
              onChange={e => update("bank_account_number",e.target.value.replace(/\s/g,""))} />
            <Button type="button" variant="outline" size="icon"
              aria-label={showNumber ? "Hide account number" : "Show account number"}
              onClick={() => setShowNumber(x => !x)}>{showNumber ? <EyeOff/> : <Eye/>}</Button>
          </div>
        </div>
        <div>
          <Label htmlFor="vendor-ifsc">IFSC</Label>
          <Input id="vendor-ifsc" maxLength={11} autoCapitalize="characters" value={form.ifsc}
            onChange={e => update("ifsc",e.target.value.toUpperCase())} />
        </div>
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mr-1 inline h-4 w-4"/> Verify beneficiary information using an authorised document before releasing payment. Leaving all four fields blank clears them from the vendor master but does not modify historical payments.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending || details.isLoading || !!details.error}>
            {save.isPending ? "Saving…" : "Save supplier bank"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
