/** Opening bills recognize only the unpaid liability at entry. Historical
 * settlements are not new cash movements, and must not inflate vendor credit.
 * This matches invoice_transition's opening journal accounting policy. */
type Amount = string | number;
function paise(value: Amount): number {
  const n=Number(value);
  const p=Math.round(n*100);
  if (value === "" || !Number.isFinite(n) || n<0 || !Number.isSafeInteger(p) || Math.abs(n*100-p)>0.001)
    throw new Error("Cannot verify vendor ledger amount");
  return p;
}
export function openingLedgerCredit(invoice: {
  is_opening: boolean; net_payable: Amount; opening_legacy_paid: Amount;
  opening_vendor_invoice_prior_payments: readonly {amount: Amount}[];
}) {
  const net=paise(invoice.net_payable);
  if(!invoice.is_opening) return {credit:net/100,historicalPaid:0};
  let historical=paise(invoice.opening_legacy_paid);
  for(const payment of invoice.opening_vendor_invoice_prior_payments){
    historical+=paise(payment.amount);
    if(!Number.isSafeInteger(historical)) throw new Error("Historical payment total exceeds precision limit");
  }
  if(historical>net)throw new Error("Historical payments exceed net payable; review this opening invoice");
  return {credit:(net-historical)/100,historicalPaid:historical/100};
}
