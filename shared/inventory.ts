// Pure, DB-free stock/expiry classification logic shared between the
// DrugInventory UI and the test suite. Extracted so tests exercise the same
// function the app actually runs, instead of a parallel reimplementation
// that could silently diverge from real behaviour.

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type StockStatus = "out_of_stock" | "low" | "ok";

export function getStockStatus(quantity: number, lowStockThreshold: number): StockStatus {
  if (quantity === 0) return "out_of_stock";
  if (quantity <= lowStockThreshold) return "low";
  return "ok";
}

export function isDrugExpired(expiryDate: Date | string | null | undefined, now: number = Date.now()): boolean {
  if (!expiryDate) return false;
  return new Date(expiryDate).getTime() < now;
}

export function isDrugExpiringSoon(expiryDate: Date | string | null | undefined, now: number = Date.now()): boolean {
  if (!expiryDate) return false;
  const t = new Date(expiryDate).getTime();
  return t >= now && t - now <= THIRTY_DAYS_MS;
}
