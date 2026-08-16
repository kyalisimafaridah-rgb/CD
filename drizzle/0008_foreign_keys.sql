-- Migration 0008: foreign key constraints
--
-- Every relationship in this schema (patients.clinicId, visits.patientId,
-- payments.billId, etc.) has so far been enforced purely by application
-- code, with zero FK constraints anywhere in the database. This is what let
-- bill.delete hard-delete a bill while its payments rows silently kept
-- pointing at a billId that no longer existed — nothing at the DB layer
-- would have stopped that, and nothing stops the *next* app-layer bug from
-- doing the same thing to a different table.
--
-- ⚠️ IMPORTANT — READ BEFORE RUNNING THIS AGAINST A REAL DATABASE ⚠️
-- If any orphaned or mismatched rows already exist (e.g. a visit whose
-- patientId doesn't exist, or whose clinicId doesn't match its patient's
-- clinicId), the corresponding ALTER TABLE below will fail and roll back —
-- MySQL will not apply a constraint that existing data already violates.
-- That's the safe failure mode (nothing gets silently corrupted), but it
-- means you should run the orphan-check queries in
-- drizzle/0008_preflight_check.sql FIRST, on a copy of production data,
-- and resolve any hits before running this migration for real.
--
-- Cascade behavior is deliberate per relationship, not copy-pasted:
--   RESTRICT — the parent must not be deletable while children reference
--              it (money/clinical records: patients, visits, bills, payments)
--   CASCADE  — the child has no independent meaning without the parent
--              (labTests/prescribedDrugs belong entirely to one visit)
--   SET NULL — the reference is genuinely optional (a doctor row being
--              deactivated shouldn't destroy the visit it saw)

-- ── clinics as the tenant root ──────────────────────────────────────────
ALTER TABLE `users`
  ADD CONSTRAINT `fk_users_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE SET NULL;

ALTER TABLE `patients`
  ADD CONSTRAINT `fk_patients_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT;

-- ── visits ───────────────────────────────────────────────────────────────
ALTER TABLE `visits`
  ADD CONSTRAINT `fk_visits_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_visits_patient` FOREIGN KEY (`patientId`) REFERENCES `patients`(`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_visits_doctor` FOREIGN KEY (`doctorId`) REFERENCES `users`(`id`) ON DELETE SET NULL;

ALTER TABLE `labTests`
  ADD CONSTRAINT `fk_labtests_visit` FOREIGN KEY (`visitId`) REFERENCES `visits`(`id`) ON DELETE CASCADE;

ALTER TABLE `prescribedDrugs`
  ADD CONSTRAINT `fk_prescribeddrugs_visit` FOREIGN KEY (`visitId`) REFERENCES `visits`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_prescribeddrugs_drug` FOREIGN KEY (`drugId`) REFERENCES `drugs`(`id`) ON DELETE SET NULL;

-- ── billing — the relationship that motivated this migration ──────────────
ALTER TABLE `bills`
  ADD CONSTRAINT `fk_bills_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_bills_patient` FOREIGN KEY (`patientId`) REFERENCES `patients`(`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_bills_visit` FOREIGN KEY (`visitId`) REFERENCES `visits`(`id`) ON DELETE RESTRICT;

ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_bill` FOREIGN KEY (`billId`) REFERENCES `bills`(`id`) ON DELETE RESTRICT;

-- ── drugs / inventory ────────────────────────────────────────────────────
ALTER TABLE `drugs`
  ADD CONSTRAINT `fk_drugs_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT;

ALTER TABLE `drugStockHistory`
  ADD CONSTRAINT `fk_drugstockhistory_drug` FOREIGN KEY (`drugId`) REFERENCES `drugs`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_drugstockhistory_user` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_drugstockhistory_visit` FOREIGN KEY (`visitId`) REFERENCES `visits`(`id`) ON DELETE SET NULL;

-- ── appointments ─────────────────────────────────────────────────────────
ALTER TABLE `appointments`
  ADD CONSTRAINT `fk_appointments_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_appointments_patient` FOREIGN KEY (`patientId`) REFERENCES `patients`(`id`) ON DELETE RESTRICT;

-- ── everything else that hangs off a clinic ─────────────────────────────
ALTER TABLE `smsNotifications`
  ADD CONSTRAINT `fk_sms_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_sms_bill` FOREIGN KEY (`billId`) REFERENCES `bills`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_sms_drug` FOREIGN KEY (`drugId`) REFERENCES `drugs`(`id`) ON DELETE SET NULL;

ALTER TABLE `activityLog`
  ADD CONSTRAINT `fk_activitylog_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_activitylog_user` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT;

ALTER TABLE `subscriptionEvents`
  ADD CONSTRAINT `fk_subevents_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE RESTRICT;

ALTER TABLE `invites`
  ADD CONSTRAINT `fk_invites_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE CASCADE;

ALTER TABLE `serviceTemplates`
  ADD CONSTRAINT `fk_servicetemplates_clinic` FOREIGN KEY (`clinicId`) REFERENCES `clinics`(`id`) ON DELETE CASCADE;
