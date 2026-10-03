import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader } from "@/components/erp/common";
import { PrForm } from "@/components/erp/pr-form";
import { errMsg } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/procurement/purchase-requests/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Purchase Request — KK GROUP ERP" }, { name: "description", content: "Edit a draft purchase request." }, { property: "og:title", content: "Edit Purchase Request — KK GROUP ERP" }, { property: "og:description", content: "Edit a draft purchase request." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: EditPr,
});

function EditPr() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["pr-edit", id],
    queryFn: async () => {
      const [p, i] = await Promise.all([
        supabase.from("purchase_requests").select("*").eq("id", id).single(),
        supabase.from("purchase_request_items").select("*").eq("purchase_request_id", id).order("line_no"),
      ]);
      if (p.error) throw p.error;
      if (i.error) throw i.error;
      return { pr: p.data, items: i.data ?? [] };
    },
    gcTime: 0,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const { pr, items } = q.data!;
  return (
    <>
      <PageHeader title={`Edit ${pr.pr_number}`} crumbs={<Link to="/procurement/purchase-requests/$id" params={{ id }}>{pr.pr_number}</Link>} />
      {pr.status !== "draft" ? <div className="rounded-md border bg-card p-4 text-sm">Only draft requests can be edited.</div> : (
        <PrForm id={id}
          initial={{ project_id: pr.project_id, building_id: pr.building_id ?? "", floor_id: pr.floor_id ?? "", required_by: pr.required_by, priority: pr.priority, request_type: pr.request_type, purpose: pr.purpose ?? "", remarks: pr.remarks ?? "" }}
          initialLines={items.map((x) => ({ material_id: x.material_id, description: x.description ?? "", quantity: String(x.quantity), unit_id: x.unit_id, estimated_rate: x.estimated_rate == null ? "" : String(x.estimated_rate), required_by: x.required_by ?? "", notes: x.notes ?? "" }))} />
      )}
    </>
  );
}
