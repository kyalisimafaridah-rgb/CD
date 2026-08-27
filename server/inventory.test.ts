import { describe, it, expect } from "vitest";
import { getStockStatus, isDrugExpired, isDrugExpiringSoon } from "../shared/inventory";

// Rewritten: this file previously reimplemented stock-status and expiry
// logic locally (including a "bulk pricing discount" feature that was
// never actually built into the app) instead of testing real app code.
// It now imports and tests shared/inventory.ts, the same module
// DrugInventory.tsx and visit.create's expiry block use.

describe("Drug Inventory Management", () => {
  describe("getStockStatus (used by DrugInventory.tsx summary cards and row styling)", () => {
    it("flags zero quantity as out of stock regardless of threshold", () => {
      expect(getStockStatus(0, 10)).toBe("out_of_stock");
      expect(getStockStatus(0, 0)).toBe("out_of_stock");
    });

    it("flags quantity at or below the threshold as low", () => {
      expect(getStockStatus(10, 10)).toBe("low");
      expect(getStockStatus(5, 10)).toBe("low");
    });

    it("flags quantity above the threshold as ok", () => {
      expect(getStockStatus(15, 10)).toBe("ok");
    });
  });

  describe("isDrugExpired / isDrugExpiringSoon (the checks visit.create relies on to block dispensing)", () => {
    const now = new Date("2026-03-22T00:00:00Z").getTime();

    it("treats a null/undefined expiry date as not expired", () => {
      expect(isDrugExpired(null, now)).toBe(false);
      expect(isDrugExpired(undefined, now)).toBe(false);
    });

    it("identifies a past expiry date as expired", () => {
      expect(isDrugExpired("2026-01-01", now)).toBe(true);
    });

    it("identifies a future expiry date as not expired", () => {
      expect(isDrugExpired("2026-06-01", now)).toBe(false);
    });

    it("identifies a date within 30 days as expiring soon, but not expired", () => {
      expect(isDrugExpiringSoon("2026-04-10", now)).toBe(true);
      expect(isDrugExpired("2026-04-10", now)).toBe(false);
    });

    it("does not flag a date more than 30 days out as expiring soon", () => {
      expect(isDrugExpiringSoon("2026-06-01", now)).toBe(false);
    });

    it("does not double-count an already-expired drug as 'expiring soon'", () => {
      expect(isDrugExpiringSoon("2026-01-01", now)).toBe(false);
    });
  });
});
