/** Small expenses are ACTUAL independent cash/UPI/etc outgoings.
 * Never add vendor invoice value or material issue cost to this register:
 * procurement stages overlap, and these records must not double-count them.
 */
export const SMALL_EXPENSE_CATEGORIES = {
  transport: "Local transport", tea_food: "Tea & refreshments",
  fuel: "Fuel", hardware: "Minor hardware", site_supplies: "Site supplies",
  repairs: "Small repairs", cleaning: "Cleaning",
  labour_incidental: "Incidental labour", office: "Office expenses",
  other: "Other",
} as const;
export type SmallExpenseCategory = keyof typeof SMALL_EXPENSE_CATEGORIES;
export const SMALL_EXPENSE_PAYMENTS = {
  cash: "Cash", upi: "UPI", bank: "Bank transfer", card: "Card", other: "Other",
} as const;
export type SmallExpensePayment = keyof typeof SMALL_EXPENSE_PAYMENTS;

export function parseSmallExpenseAmount(value: string): number | null {
  const raw = value.trim();
  if (!/^(?:[1-9]\d{0,4}|0)(?:\.\d{1,2})?$/.test(raw)) return null;
  const paise = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(paise) || paise < 1 || paise > 5000000) return null;
  return paise / 100;
}

export type SmallExpenseAmount = {
  amount: number;
  status: "recorded" | "voided";
  category: string;
  project_id: string | null;
  building_id: string | null;
};
export function summarizeSmallExpenses(rows: readonly SmallExpenseAmount[]) {
  const byCategory = new Map<string,number>();
  const byProject = new Map<string,number>();
  const byBuilding = new Map<string,number>();
  let total = 0, count = 0, voided = 0;
  for(const row of rows) {
    const amount = Number(row.amount);
    if(!Number.isFinite(amount)||amount<=0) throw new Error("Invalid amount in small expense register");
    if(row.status==="voided"){voided++;continue;}
    if(row.status!=="recorded")throw new Error("Invalid small expense state");
    total+=amount;count++;
    byCategory.set(row.category,(byCategory.get(row.category)??0)+amount);
    byProject.set(row.project_id??"office",(byProject.get(row.project_id??"office")??0)+amount);
    if(row.building_id)byBuilding.set(row.building_id,(byBuilding.get(row.building_id)??0)+amount);
  }
  const money=(n:number)=>Math.round(n*100)/100;
  return {total:money(total),count,voided,byCategory:new Map([...byCategory].map(([k,v])=>[k,money(v)])),
    byProject:new Map([...byProject].map(([k,v])=>[k,money(v)])),
    byBuilding:new Map([...byBuilding].map(([k,v])=>[k,money(v)]))};
}
