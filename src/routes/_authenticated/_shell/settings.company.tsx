import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Loading, Field } from "@/components/erp/common";

export const Route = createFileRoute("/_authenticated/_shell/settings/company")({
  head: () => ({ meta: [{ title: "Company Settings — KK Group ERP" }, { name: "description", content: "Company profile." }, { property: "og:title", content: "Company Settings" }, { property: "og:description", content: "Company profile." }] }),
  component: Company,
});

function Company() {
  const q = useQuery({ queryKey: ["company"], queryFn: async () => { const r = await supabase.from("companies").select("*").limit(1).single(); if (r.error) throw r.error; return r.data; } });
  if (q.isLoading) return <Loading />;
  const c = q.data!;
  return (
    <>
      <PageHeader title={c.name} subtitle={c.legal_name} />
      <div className="grid gap-4 rounded-md border bg-card p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="PAN">{c.pan}</Field><Field label="TAN">{c.tan}</Field><Field label="GSTIN">{c.gstin}</Field>
        <Field label="CIN">{c.cin}</Field><Field label="RERA">{c.rera_promoter_id}</Field><Field label="Phone">{c.phone}</Field>
        <Field label="Email">{c.email}</Field><Field label="Registered address">{c.registered_address}</Field><Field label="Office address">{c.office_address}</Field>
      </div>
    </>
  );
}
