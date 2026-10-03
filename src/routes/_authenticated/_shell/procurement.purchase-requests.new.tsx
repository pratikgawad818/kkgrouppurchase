import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/erp/common";
import { PrForm } from "@/components/erp/pr-form";
import { useCan } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/_shell/procurement/purchase-requests/new")({
  head: () => ({ meta: [{ title: "New Purchase Request — KK GROUP ERP" }, { name: "description", content: "Raise a purchase request for project materials." }, { property: "og:title", content: "New Purchase Request — KK GROUP ERP" }, { property: "og:description", content: "Raise a purchase request for project materials." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: NewPr,
});

function NewPr() {
  const can = useCan();
  return (
    <>
      <PageHeader title="New purchase request" crumbs={<Link to="/procurement/purchase-requests">Purchase Requests</Link>} subtitle="PR number is assigned automatically when you save." />
      {can("purchase_request.create") ? <PrForm /> : <div className="rounded-md border bg-card p-4 text-sm">You do not have permission to create purchase requests.</div>}
    </>
  );
}
