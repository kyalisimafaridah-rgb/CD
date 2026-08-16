import { describe, it, expect } from "vitest";
import { formatBillNumber, validatePaymentAmount, calculateBillTotal, getPaymentStatus } from "../shared/billing";

// Rewritten: this file previously asserted against a fabricated bill-number
// format ("BILL-{clinicId}-00001") that never matched the real format
// produced by db.ts's getNextBillNumber ("INV-YYYYMM-0001"), and reimplemented
// payment validation locally instead of testing the real check in
// bill.markAsPaid. It now imports shared/billing.ts, which both routers.ts
// and db.ts use directly.

describe("Billing System", () => {
  describe("Bill Calculation", () => {
    it("sums consultation + lab + drug totals into the grand total", () => {
      expect(calculateBillTotal(50000, 30000, 25000)).toBe(105000);
    });

    it("classifies partial payment status", () => {
      expect(getPaymentStatus(100000, 60000)).toBe("partial");
    });

    it("classifies unpaid status when nothing has been paid", () => {
      expect(getPaymentStatus(100000, 0)).toBe("unpaid");
    });

    it("classifies paid status once the balance reaches zero", () => {
      expect(getPaymentStatus(100000, 100000)).toBe("paid");
    });
  });

  describe("validatePaymentAmount (the check bill.markAsPaid uses)", () => {
    it("rejects a zero or negative amount", () => {
      expect(validatePaymentAmount(0, 100000)).toEqual({ valid: false, error: "Amount must be positive" });
      expect(validatePaymentAmount(-5000, 100000)).toEqual({ valid: false, error: "Amount must be positive" });
    });

    it("accepts an amount within the outstanding balance", () => {
      expect(validatePaymentAmount(50000, 100000)).toEqual({ valid: true });
    });

    it("accepts an amount that exactly matches the outstanding balance", () => {
      expect(validatePaymentAmount(100000, 100000)).toEqual({ valid: true });
    });

    it("rejects an amount that exceeds the outstanding balance — the overpayment bug this check fixes", () => {
      expect(validatePaymentAmount(150000, 100000)).toEqual({
        valid: false,
        error: "Amount exceeds outstanding balance",
      });
    });
  });

  describe("formatBillNumber (must match db.ts's getNextBillNumber exactly, or reconciliation queries break)", () => {
    it("formats with a 4-digit zero-padded sequence", () => {
      expect(formatBillNumber(2026, 3, 1)).toBe("INV-202603-0001");
      expect(formatBillNumber(2026, 3, 100)).toBe("INV-202603-0100");
    });

    it("zero-pads single-digit months", () => {
      expect(formatBillNumber(2026, 1, 1)).toBe("INV-202601-0001");
    });
  });
});
