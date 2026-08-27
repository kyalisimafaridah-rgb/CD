// Pure billing helpers shared between server/routers.ts + server/db.ts and
// the test suite, so tests exercise the same logic the app runs rather than
// a disconnected reimplementation.

/** Matches the format built in db.ts's getNextBillNumber: INV-YYYYMM-0001 */
export function formatBillNumber(year: number, month: number, sequence: number): string {
  return `INV-${year}${String(month).padStart(2, "0")}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Same check used in bill.markAsPaid (routers.ts) to reject a payment that
 * exceeds the outstanding balance — added because overpayments used to be
 * silently absorbed with no credit/refund trail.
 */
export function validatePaymentAmount(
  amount: number,
  outstandingBalance: number
): { valid: true } | { valid: false; error: string } {
  if (amount <= 0) return { valid: false, error: "Amount must be positive" };
  if (amount > outstandingBalance + 0.01) {
    return { valid: false, error: "Amount exceeds outstanding balance" };
  }
  return { valid: true };
}

export function calculateBillTotal(
  consultationFee: number,
  labTotal: number,
  drugTotal: number
): number {
  return consultationFee + labTotal + drugTotal;
}

export function getPaymentStatus(grandTotal: number, amountPaid: number): "unpaid" | "partial" | "paid" {
  const balance = grandTotal - amountPaid;
  if (balance <= 0) return "paid";
  if (amountPaid > 0) return "partial";
  return "unpaid";
}
