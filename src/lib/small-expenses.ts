/** Small expenses are ACTUAL independent cash/UPI/etc outgoings.
 * Never add vendor invoice value or material issue cost to this register:
 * procurement stages overlap, and these records must not double-count them.
 */
export const SMALL_EXPENSE_CATEGORIES = {
  transport: "Local transport", tea_food: "Tea & refreshments",
  fuel: "Fuel", hardware: "Minor hardware", site_supplies: "Site supplies",
  repairs: "Small repairs", cleaning: "Cleaning",
  labour_incidental: "Incidental labour", office: "Office expenses",
  security_guard: "Security Guard",
  other: "Other",
} as const;
export type SmallExpenseCategory = keyof typeof SMALL_EXPENSE_CATEGORIES;
export const SMALL_EXPENSE_PAYMENTS = {
  cash: "Cash", upi: "UPI", bank: "Bank transfer", card: "Card", other: "Other",
} as const;
export type SmallExpensePayment = keyof typeof SMALL_EXPENSE_PAYMENTS;

/** Valid rupees/paise without an arbitrary per-entry business cap.
 * The underlying numeric(14,2) DB column permits up to 12 integer digits;
 * parse into integer paise first to avoid floating-point acceptance errors.
 */
export function parseSmallExpenseAmount(value: string): number | null {
  const raw = value.trim();
  if (!/^(?:[1-9]\\d{0,11}|0)(?:\\.\\d{1,2})?$/.test(raw)) return null;
  const [rupees = "", fractional = ""] = raw.split(".");
  const paise = BigInt(rupees) * 100n + BigInt(fractional.padEnd(2, "0") || "0");
  if (paise < 1n || paise > 99_999_999_999_999n) return null;
  return Number(paise) / 100;
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
