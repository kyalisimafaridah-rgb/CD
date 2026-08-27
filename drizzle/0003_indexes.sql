-- Migration 0003: Performance indexes
-- Adds indexes on all columns used in WHERE clauses, ORDER BY, and JOINs.
-- Without these, every search scans the full table — fine at 100 rows,
-- unusable at 5,000+.

-- ─── users ───────────────────────────────────────────────────────────────────
CREATE INDEX `idx_users_email`     ON `users` (`email`);
CREATE INDEX `idx_users_phone`     ON `users` (`phone`);
CREATE INDEX `idx_users_clinicId`  ON `users` (`clinicId`);
--> statement-breakpoint

-- ─── patients ────────────────────────────────────────────────────────────────
CREATE INDEX `idx_patients_clinicId`   ON `patients` (`clinicId`);
CREATE INDEX `idx_patients_firstName`  ON `patients` (`firstName`);
CREATE INDEX `idx_patients_lastName`   ON `patients` (`lastName`);
CREATE INDEX `idx_patients_phone`      ON `patients` (`phone`);
CREATE INDEX `idx_patients_createdAt`  ON `patients` (`createdAt`);
--> statement-breakpoint

-- ─── visits ──────────────────────────────────────────────────────────────────
CREATE INDEX `idx_visits_clinicId`   ON `visits` (`clinicId`);
CREATE INDEX `idx_visits_patientId`  ON `visits` (`patientId`);
CREATE INDEX `idx_visits_doctorId`   ON `visits` (`doctorId`);
CREATE INDEX `idx_visits_visitDate`  ON `visits` (`visitDate`);
CREATE INDEX `idx_visits_status`     ON `visits` (`status`);
--> statement-breakpoint

-- ─── bills ───────────────────────────────────────────────────────────────────
CREATE INDEX `idx_bills_clinicId`       ON `bills` (`clinicId`);
CREATE INDEX `idx_bills_patientId`      ON `bills` (`patientId`);
CREATE INDEX `idx_bills_visitId`        ON `bills` (`visitId`);
CREATE INDEX `idx_bills_billDate`       ON `bills` (`billDate`);
CREATE INDEX `idx_bills_paymentStatus`  ON `bills` (`paymentStatus`);
--> statement-breakpoint

-- ─── payments ────────────────────────────────────────────────────────────────
CREATE INDEX `idx_payments_billId`       ON `payments` (`billId`);
CREATE INDEX `idx_payments_paymentDate`  ON `payments` (`paymentDate`);
CREATE INDEX `idx_payments_status`       ON `payments` (`status`);
--> statement-breakpoint

-- ─── appointments ────────────────────────────────────────────────────────────
CREATE INDEX `idx_appointments_clinicId`     ON `appointments` (`clinicId`);
CREATE INDEX `idx_appointments_patientId`    ON `appointments` (`patientId`);
CREATE INDEX `idx_appointments_appointmentDate` ON `appointments` (`appointmentDate`);
CREATE INDEX `idx_appointments_status`       ON `appointments` (`status`);
--> statement-breakpoint

-- ─── drugs ───────────────────────────────────────────────────────────────────
CREATE INDEX `idx_drugs_clinicId`  ON `drugs` (`clinicId`);
CREATE INDEX `idx_drugs_name`      ON `drugs` (`drugName`);
--> statement-breakpoint

-- ─── prescribedDrugs ─────────────────────────────────────────────────────────
CREATE INDEX `idx_prescribedDrugs_visitId`  ON `prescribedDrugs` (`visitId`);
CREATE INDEX `idx_prescribedDrugs_drugId`   ON `prescribedDrugs` (`drugId`);
--> statement-breakpoint

-- ─── labTests ────────────────────────────────────────────────────────────────
CREATE INDEX `idx_labTests_visitId`  ON `labTests` (`visitId`);
--> statement-breakpoint

-- ─── smsNotifications ────────────────────────────────────────────────────────
CREATE INDEX `idx_smsNotifications_clinicId`   ON `smsNotifications` (`clinicId`);
-- Note: idx_smsNotifications_patientId removed — smsNotifications has no
-- patientId column (only recipientPhone, appointmentId, billId, drugId), and
-- this index silently failed to create on every boot as a result.
CREATE INDEX `idx_smsNotifications_sentAt`     ON `smsNotifications` (`sentDate`);
--> statement-breakpoint

-- ─── activityLog ─────────────────────────────────────────────────────────────
CREATE INDEX `idx_activityLog_clinicId`   ON `activityLog` (`clinicId`);
CREATE INDEX `idx_activityLog_userId`     ON `activityLog` (`userId`);
CREATE INDEX `idx_activityLog_createdAt`  ON `activityLog` (`createdAt`);
--> statement-breakpoint

-- ─── drugStockHistory ────────────────────────────────────────────────────────
CREATE INDEX `idx_drugStockHistory_drugId`     ON `drugStockHistory` (`drugId`);
CREATE INDEX `idx_drugStockHistory_createdAt`  ON `drugStockHistory` (`createdAt`);
--> statement-breakpoint

-- ─── invites ─────────────────────────────────────────────────────────────────
CREATE INDEX `idx_invites_clinicId`   ON `invites` (`clinicId`);
CREATE INDEX `idx_invites_expiresAt`  ON `invites` (`expiresAt`);
--> statement-breakpoint

-- ─── otpCodes ────────────────────────────────────────────────────────────────
CREATE INDEX `idx_otpCodes_phone`      ON `otpCodes` (`phone`);
CREATE INDEX `idx_otpCodes_expiresAt`  ON `otpCodes` (`expiresAt`);
