import { createFileRoute } from "@tanstack/react-router";
import { SalesDashboard } from "./sales-dashboard";
export const Route=createFileRoute("/_authenticated/_shell/sales-projects")({head:()=>({meta:[{title:"Projects Performance — KK GROUP ERP"}]}),component:()=> <SalesDashboard initialView="projects"/>});
