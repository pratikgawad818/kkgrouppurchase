/**
 * Isolated browser fixture for the REAL SmallExpenseDetail component.
 * No live user data, authentication tokens, Supabase queries or database calls.
 * QueryClient is pre-populated with synthetic expense receipts and audit events.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SmallExpenseDetail, type SmallExpenseRecord } from "@/components/erp/small-expense-detail";

const record: SmallExpenseRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  spent_on: "2026-11-19",
  project_id: "00000000-0000-4000-8000-000000000002",
  building_id: "00000000-0000-4000-8000-000000000003",
  category: "other",
  other_category_detail: "Emergency plumbing and general repairs",
  amount: 125000.5,
  payment_method: "upi",
  paid_to: "ABC Construction and Hardware Supplies Pvt. Ltd.",
  description: "Urgent building maintenance and plumbing materials delivered directly to Site Tower B. Invoice and approved expense receipt are attached. No purchase order was issued for this incidental site expense.",
  receipt_reference: "KK-PG-BILL-2026-11-19-00123-VERY-LONG-REFERENCE",
  status: "recorded",
  created_at: "2026-11-19T10:08:00+05:30",
  updated_at: "2026-11-19T13:44:00+05:30",
  projects: { name: "KK Park - Phase II Construction Works" },
  buildings: { name: "Tower B - Residential Block" },
};

const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Number.POSITIVE_INFINITY, retry: false },
  },
});

client.setQueryData(["small-expense-detail", record.id, "bills"], [
  {
    id: "test-bill-1",
    expense_id: record.id,
    storage_path: "fake/private/expense/receipt.pdf",
    file_name: "Final-materials-and-labour-invoice-2026-November.pdf",
    mime_type: "application/pdf",
    byte_size: 1224075,
    is_active: true,
    created_at: "2026-11-19T10:08:00+05:30",
  },
  {
    id: "test-bill-2",
    expense_id: record.id,
    storage_path: "fake/private/expense/photo.jpg",
    file_name: "20261119_103010_supplier_receipt.jpg",
    mime_type: "image/jpeg",
    byte_size: 210445,
    is_active: true,
    created_at: "2026-11-19T10:08:00+05:30",
  },
]);

client.setQueryData(["small-expense-detail", record.id, "events"], [
  {
    id: "test-event-1",
    action: "edited",
    reason: "Corrected the supplier bill amount and expense description after verification.",
    actor_id: "test-accounts-manager",
    created_at: "2026-11-19T13:44:00+05:30",
    before_values: {
      amount: 123000,
      description: "Site materials",
      paid_to: "ABC Construction Supplies",
    },
    after_values: {
      amount: 125000.5,
      description: record.description,
      paid_to: record.paid_to,
    },
  },
  {
    id: "test-event-2",
    action: "recorded",
    reason: null,
    actor_id: "test-accounts-manager",
    created_at: "2026-11-19T10:08:00+05:30",
    before_values: null,
    after_values: null,
  },
]);

const node = document.getElementById("root");
if (!node) throw new Error("Missing test root");
createRoot(node).render(
  <QueryClientProvider client={client}>
    <div id="underlying-workspace" style={{ padding: "16px", minHeight: "100dvh" }}>
      <h1>KK GROUP ERP — Small Expenses</h1>
      <p>Mobile workspace behind the read-only expense viewer</p>
      <nav id="fake-bottom-nav" style={{position:"fixed",bottom:0,left:0,right:0,height:75,zIndex:35,background:"#ddd"}}>
        Workspace Bottom Menu
      </nav>
    </div>
    <SmallExpenseDetail expense={record} onClose={() => {
      document.documentElement.setAttribute("data-test-closed", "true");
    }} />
  </QueryClientProvider>,
);
