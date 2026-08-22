-- Run this against a COPY of production data before applying
-- 0008_foreign_keys.sql. Every query should return 0 rows. Any row
-- returned here means 0008 will fail (safely) on that constraint — fix the
-- underlying data, or decide the row should be deleted, before migrating.

-- Orphaned patients (clinicId doesn't exist)
SELECT p.id, p.clinicId FROM patients p
LEFT JOIN clinics c ON c.id = p.clinicId
WHERE c.id IS NULL;

-- Orphaned visits (patientId or clinicId doesn't exist)
SELECT v.id, v.patientId, v.clinicId FROM visits v
LEFT JOIN patients p ON p.id = v.patientId
LEFT JOIN clinics c ON c.id = v.clinicId
WHERE p.id IS NULL OR c.id IS NULL;

-- Cross-clinic mismatch: a visit whose patient belongs to a different clinic
-- than the visit itself — this is the exact class of bug the tenant-isolation
-- review checked for in application code; this confirms it never happened.
SELECT v.id AS visitId, v.clinicId AS visitClinic, p.clinicId AS patientClinic
FROM visits v JOIN patients p ON p.id = v.patientId
WHERE v.clinicId <> p.clinicId;

-- Orphaned bills
SELECT b.id, b.patientId, b.visitId, b.clinicId FROM bills b
LEFT JOIN patients p ON p.id = b.patientId
LEFT JOIN visits v ON v.id = b.visitId
LEFT JOIN clinics c ON c.id = b.clinicId
WHERE p.id IS NULL OR v.id IS NULL OR c.id IS NULL;

-- Orphaned payments — the exact scenario bill.delete could have caused
SELECT pay.id, pay.billId FROM payments pay
LEFT JOIN bills b ON b.id = pay.billId
WHERE b.id IS NULL;

-- Orphaned appointments
SELECT a.id, a.patientId, a.clinicId FROM appointments a
LEFT JOIN patients p ON p.id = a.patientId
LEFT JOIN clinics c ON c.id = a.clinicId
WHERE p.id IS NULL OR c.id IS NULL;

-- Orphaned prescribedDrugs / labTests
SELECT pd.id, pd.visitId FROM prescribedDrugs pd
LEFT JOIN visits v ON v.id = pd.visitId
WHERE v.id IS NULL;

SELECT lt.id, lt.visitId FROM labTests lt
LEFT JOIN visits v ON v.id = lt.visitId
WHERE v.id IS NULL;

-- activityLog rows referencing a deleted user (would block fk_activitylog_user
-- since it's set to RESTRICT — change to SET NULL in 0008 if this returns rows
-- and you don't want to backfill/delete them)
SELECT al.id, al.userId FROM activityLog al
LEFT JOIN users u ON u.id = al.userId
WHERE u.id IS NULL;
