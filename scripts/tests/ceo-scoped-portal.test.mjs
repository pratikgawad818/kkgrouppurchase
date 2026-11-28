import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPage } from "../../src/lib/page-access.ts";
import { workspaceNavigation,mobileWorkspaceNavigation } from "../../src/lib/workspace-navigation.ts";
const read=p=>readFileSync(p,"utf8");
test("CEO and senior sales navigate only to sales, flat inventory, scoped expenses and profile",()=>{
 for(const role of ["ceo","senior_sales_executive"]){
  const user={roles:[role],permissions:new Set(["units.view","sales.bookings","sales.collections","small_expense.create"])};
  const groups=workspaceNavigation(user);
  assert.deepEqual(groups.flatMap(g=>g.items.map(i=>i.to)),["/sales","/units","/finance/small-expenses","/profile"]);
  assert.deepEqual(mobileWorkspaceNavigation(groups).map(i=>i.to),["/sales","/units","/finance/small-expenses"]);
  for(const path of ["/dashboard","/finance/payments","/finance/vendor-invoices","/approvals","/settings/users","/procurement/purchase-orders","/management"])assert.equal(canAccessPage(path,user),false,path);
 }
});
test("database requires explicit sales assignment, proof ownership, and separate expense read permissions",()=>{
 const sql=read("drizzle/migrations/0125_scoped_sales_portal.sql");
 for(const snippet of ["NOT public.is_project_sales_staff(_user_id)","sales_project_allowed(sale.project_id)","o.owner_id=auth.uid()::text","Payment receipt proof is required","property_receipt_unique_proof","Payment exceeds remaining amount","Assigned sales staff read expenses","AS RESTRICTIVE","deal_terms_updated"])assert.ok(sql.includes(snippet),snippet);
 const ui=read("src/components/erp/sales-register.tsx");
 for(const snippet of ["sales_book_flat_with_terms","sales_report_receipt_with_proof","Payment receipt / proof","View proof","Amenities granted","Referral details"])assert.ok(ui.includes(snippet),snippet);
});

test("CEO and senior sales cannot add individual, bulk or imported flat masters",()=>{
 const sql=read("drizzle/migrations/0126_restrict_flat_master_creation.sql");
 assert.equal((sql.match(/IF NOT public\.sales_manager\(\) OR public\.is_project_sales_staff\(auth\.uid\(\)\)/g)??[]).length,3);
 const ui=read("src/components/erp/sales-register.tsx");
 assert.ok(ui.includes("const canCreateFlats=manager&&!scopedSales"));
 assert.ok(ui.includes("canImport={canCreateFlats}"));
 assert.ok(ui.includes("sales_book_flat_with_terms"));
});
