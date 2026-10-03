import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { errMsg } from "@/lib/format";
import { useCan } from "@/lib/session";
import type { FinanceSettings } from "@/lib/finance";

const META = "Invoice matching tolerances and TDS sections.";
export const Route = createFileRoute("/_authenticated/_shell/settings/finance")({
  head: () => ({ meta: [{ title: "Finance Settings — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Finance Settings — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: FinanceSettingsPage,
});

function FinanceSettingsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["finance-settings"], queryFn: async () => { const { data, error } = await supabase.from("companies").select("finance_settings").limit(1).single(); if (error) throw error; return data.finance_settings as unknown as FinanceSettings; } });
  const [s, setS] = useState<FinanceSettings>({ qty_tolerance_pct: 0, rate_tolerance_pct: 1, value_tolerance: 100, tds_sections: [] });
  useEffect(() => { if (q.data) setS({ ...q.data, tds_sections: q.data.tds_sections ?? [] }); }, [q.data]);
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("update_finance_settings", { _settings: s }); if (error) throw error; },
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["finance-settings"] }); qc.invalidateQueries({ queryKey: ["vi-form-base"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (q.isLoading) return <Loading />;
  const ro = !can("company.manage");
  return (
    <>
      <PageHeader title="Finance Settings" subtitle="Used by the three-way match on vendor invoices. Differences within these limits count as Matched." />
      <div className="max-w-3xl space-y-4">
        <div className="grid gap-3 rounded-md border bg-card p-4 sm:grid-cols-3">
          <Field label="Quantity tolerance %"><Input type="number" min={0} disabled={ro} value={s.qty_tolerance_pct} onChange={(e) => setS({ ...s, qty_tolerance_pct: Number(e.target.value) })} /></Field>
          <Field label="Rate tolerance %"><Input type="number" min={0} disabled={ro} value={s.rate_tolerance_pct} onChange={(e) => setS({ ...s, rate_tolerance_pct: Number(e.target.value) })} /></Field>
          <Field label="Invoice value tolerance ₹"><Input type="number" min={0} disabled={ro} value={s.value_tolerance} onChange={(e) => setS({ ...s, value_tolerance: Number(e.target.value) })} /></Field>
        </div>
        <div className="rounded-md border bg-card p-4">
          <div className="mb-2 text-sm font-medium">TDS sections</div>
          <p className="mb-3 text-xs text-muted-foreground">Add the sections and rates your accountant uses. Nothing is pre-filled.</p>
          {s.tds_sections.map((t, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Input className="w-28" placeholder="Section" disabled={ro} value={t.code} onChange={(e) => setS({ ...s, tds_sections: s.tds_sections.map((x, j) => j === i ? { ...x, code: e.target.value } : x) })} />
              <Input placeholder="Description" disabled={ro} value={t.label} onChange={(e) => setS({ ...s, tds_sections: s.tds_sections.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
              <Input className="w-24" type="number" min={0} placeholder="Rate %" disabled={ro} value={t.rate} onChange={(e) => setS({ ...s, tds_sections: s.tds_sections.map((x, j) => j === i ? { ...x, rate: Number(e.target.value) } : x) })} />
              {!ro && <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setS({ ...s, tds_sections: s.tds_sections.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>}
            </div>))}
          {!ro && <Button variant="outline" size="sm" onClick={() => setS({ ...s, tds_sections: [...s.tds_sections, { code: "", label: "", rate: 0 }] })}>Add section</Button>}
        </div>
        {!ro && <Button disabled={save.isPending} onClick={() => save.mutate()}>Save settings</Button>}
      </div>
    </>
  );
}
