import { describe, it, expect } from "vitest";
import { formatPatientId, namesMatch, phonesMatch } from "../shared/patients";

// Rewritten: this file previously asserted hardcoded literals against
// themselves ("P-001" === "P-001") rather than calling any real code, and
// its own comment admitted "in a real scenario, we would mock the
// database" without doing so. It now imports shared/patients.ts, which
// db.ts's getNextPatientId and routers.ts's duplicate-patient check both
// use directly.

describe("Patient Management", () => {
  describe("formatPatientId (must match db.ts's getNextPatientId exactly)", () => {
    it("zero-pads to 3 digits", () => {
      expect(formatPatientId(1)).toBe("P-001");
      expect(formatPatientId(10)).toBe("P-010");
      expect(formatPatientId(100)).toBe("P-100");
    });

    it("doesn't truncate beyond 3 digits", () => {
      expect(formatPatientId(1000)).toBe("P-1000");
    });
  });

  describe("namesMatch (the duplicate-patient check in patient.create)", () => {
    it("matches identical names", () => {
      expect(namesMatch("John", "Doe", "John", "Doe")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(namesMatch("john", "doe", "John", "Doe")).toBe(true);
    });

    it("ignores surrounding whitespace", () => {
      expect(namesMatch("John ", " Doe", "John", "Doe")).toBe(true);
    });

    it("treats null and undefined last names as equivalent (DB stores null, forms send undefined)", () => {
      expect(namesMatch("John", null, "John", undefined)).toBe(true);
    });

    it("does not match different names", () => {
      expect(namesMatch("John", "Doe", "Jane", "Smith")).toBe(false);
    });
  });

  describe("phonesMatch (the secondary duplicate signal, added because name-only matching missed typo'd names)", () => {
    it("matches identical phone numbers", () => {
      expect(phonesMatch("256701234567", "256701234567")).toBe(true);
    });

    it("ignores formatting differences (spaces, dashes)", () => {
      expect(phonesMatch("0770-123 456", "0770123456")).toBe(true);
    });

    it("does not match short/empty numbers even if both are blank", () => {
      expect(phonesMatch("", "")).toBe(false);
      expect(phonesMatch(null, null)).toBe(false);
    });

    it("does not match different numbers", () => {
      expect(phonesMatch("256701234567", "256709999999")).toBe(false);
    });
  });
});
