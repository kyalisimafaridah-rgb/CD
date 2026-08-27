// Pure patient-identity helpers shared between server code and tests.

/** Matches the format built in db.ts's getNextPatientId: P-001 */
export function formatPatientId(sequence: number): string {
  return `P-${String(sequence).padStart(3, "0")}`;
}

/** Case/whitespace-insensitive name comparison used by patient.create's duplicate check (fix for the old exact-match-only comparison). */
export function normalizeName(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

export function namesMatch(
  aFirst: string | null | undefined,
  aLast: string | null | undefined,
  bFirst: string | null | undefined,
  bLast: string | null | undefined
): boolean {
  return normalizeName(aFirst) === normalizeName(bFirst) && normalizeName(aLast) === normalizeName(bLast);
}

/** Digits-only phone comparison, used for the phone-based duplicate signal. */
export function normalizePhone(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length >= 7 && na === nb;
}
