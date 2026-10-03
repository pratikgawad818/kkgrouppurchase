import { supabase } from "@/integrations/supabase/client";

export async function loadRfq(id: string) {
  const [r, i, v, q, s] = await Promise.all([
    supabase.from("rfqs").select("*, projects(code,name), buildings(name), purchase_requests(id,pr_number)").eq("id", id).single(),
    supabase.from("rfq_items").select("*, items(code,name), units_of_measure(code)").eq("rfq_id", id).order("line_no"),
    supabase.from("rfq_vendors").select("*, vendors(code,company_name,contact_person,mobile,email)").eq("rfq_id", id).order("invited_at"),
    supabase.from("vendor_quotations").select("*, vendors(company_name), vendor_quotation_items(*)").eq("rfq_id", id),
    supabase.from("vendor_selections").select("*, vendors(company_name)").eq("rfq_id", id),
  ]);
  for (const x of [r, i, v, q, s]) if (x.error) throw x.error;
  return { rfq: r.data!, items: i.data ?? [], vendors: v.data ?? [], quotes: q.data ?? [], selections: s.data ?? [] };
}

