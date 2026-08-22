import { describe, it, expect } from "vitest";
import { isDuplicateOnColumn, DuplicateMutationError } from "./db";

// isDuplicateOnColumn is the primitive every offline-sync idempotency check
// is built on (patient.create, appointment.create, payment creation, and
// now the visit.create race fix all depend on it correctly telling a
// clientMutationId collision apart from any other unique-constraint hit on
// the same table). It was previously untested — this file exercises it
// against realistic MySQL and Postgres error shapes instead of the happy path only.

describe("isDuplicateOnColumn", () => {
  it("matches a real mysql2 ER_DUP_ENTRY error mentioning the column", () => {
    const error = {
      code: "ER_DUP_ENTRY",
      message:
        "Duplicate entry 'abc-123' for key 'visits.visits_clientMutationId_unique'",
    };
    expect(isDuplicateOnColumn(error, "clientMutationId")) .toBe(true);
  });

  it("is case-insensitive on the column name match", () => {
    const error = {
      code: "ER_DUP_ENTRY",
      message: "Duplicate entry for key 'patients.patients_CLIENTMUTATIONID_unique'",
    };
    expect(isDuplicateOnColumn(error, "clientMutationId")).toBe(true);
  });

  it("does NOT match a duplicate on a different unique constraint on the same table", () => {
    // This is the exact ambiguity isDuplicateOnColumn exists to resolve:
    // patients has two unique indexes (clinicId+patientId, and
    // clientMutationId) and mysql2 collapses both to ER_DUP_ENTRY.
    const error = {
      code: "ER_DUP_ENTRY",
      message: "Duplicate entry for key 'patients.patients_clinicId_patientId_unique'",
    };
    expect(isDuplicateOnColumn(error, "clientMutationId")).toBe(false);
  });

  it("does not match a non-duplicate error code even if the message mentions the column", () => {
    const error = { code: "ER_BAD_FIELD_ERROR", message: "Unknown column 'clientMutationId'" };
    expect(isDuplicateOnColumn(error, "clientMutationId")).toBe(false);
  });

  it("handles missing/malformed error objects without throwing", () => {
    expect(isDuplicateOnColumn(null, "clientMutationId")).toBe(false);
    expect(isDuplicateOnColumn(undefined, "clientMutationId")).toBe(false);
    expect(isDuplicateOnColumn({}, "clientMutationId")).toBe(false);
    expect(isDuplicateOnColumn({ code: "ER_DUP_ENTRY" }, "clientMutationId")).toBe(false);
  });

  it("matches a Postgres unique_violation (23505) with constraint name", () => {
    const error = {
      code: "23505",
      constraint: "visits_clientMutationId_unique",
      detail: "Key (\"clientMutationId\")=(abc-123) already exists.",
      message: "duplicate key value violates unique constraint \"visits_clientMutationId_unique\"",
    };
    expect(isDuplicateOnColumn(error, "clientMutationId")).toBe(true);
  });

  it("does not match a Postgres unique_violation on a different constraint", () => {
    const error = {
      code: "23505",
      constraint: "patients_clinicId_patientId_unique",
      message: "duplicate key value violates unique constraint \"patients_clinicId_patientId_unique\"",
    };
    expect(isDuplicateOnColumn(error, "clientMutationId")).toBe(false);
  });

});

describe("DuplicateMutationError", () => {
  it("carries the existing row's id so callers can report it if needed", () => {
    const err = new DuplicateMutationError(42);
    expect(err.existingId).toBe(42);
    expect(err.name).toBe("DuplicateMutationError");
    expect(err instanceof Error).toBe(true);
  });

  it("is distinguishable from a plain Error via instanceof — this is what visit.create's catch relies on to decide whether to abort cleanly or rethrow", () => {
    const err = new DuplicateMutationError(1);
    const plain = new Error("something else");
    expect(err instanceof DuplicateMutationError).toBe(true);
    expect(plain instanceof DuplicateMutationError).toBe(false);
  });
});
