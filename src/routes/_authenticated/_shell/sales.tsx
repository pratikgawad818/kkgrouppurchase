import { createFileRoute } from "@tanstack/react-router";
import { SalesPage } from "@/components/erp/sales-register";

export const Route = createFileRoute("/_authenticated/_shell/sales")({
  head: () => ({meta: [{title: "Sales & Bookings — KK GROUP ERP"}]}),
  validateSearch: (search:Record<string,unknown>):{tab?:"inventory"|"bookings"|"receipts";project?:string}=>({...(search.tab==="inventory"||search.tab==="bookings"||search.tab==="receipts"?{tab:search.tab}:{}),...(typeof search.project==="string"?{project:search.project}:{})}),
  component: ()=>{const search=Route.useSearch();return <SalesPage key={(search.tab??"")+"|"+(search.project??"")} initialTab={search.tab} initialProject={search.project}/>;},
});
