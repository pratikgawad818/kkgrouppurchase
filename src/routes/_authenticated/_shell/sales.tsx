import { createFileRoute } from "@tanstack/react-router";
import { SalesPage } from "@/components/erp/sales-register";

export const Route = createFileRoute("/_authenticated/_shell/sales")({
  head: () => ({meta: [{title: "Sales & Bookings — KK GROUP ERP"}]}),
  component: SalesPage,
});
