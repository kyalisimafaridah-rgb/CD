-- Migration 0002: sync schema.ts with applied migrations
-- Adds all columns, tables, and enum values that exist in the Drizzle schema
-- but are missing from migrations 0000 and 0001.

-- ─── users: add auth/security columns ────────────────────────────────────────
-- passwordHash was missing from every prior migration despite being the core
-- column for the email/password auth system that replaced Manus OAuth — every
-- register/login/resetPassword/acceptInvite call depends on it. Without this,
-- a database built from these migration files alone (e.g. a fresh Aiven
-- instance, or this app's own auto-run-migrations-on-boot startup path)
-- would reject every signup with "Unknown column 'passwordHash'".
ALTER TABLE `users`
  ADD COLUMN `passwordHash` varchar(255) NULL,
  ADD COLUMN `sessionVersion` int NOT NULL DEFAULT 0,
  ADD COLUMN `failedLoginAttempts` int NOT NULL DEFAULT 0,
  ADD COLUMN `lockedUntil` timestamp NULL,
  ADD COLUMN `passwordResetToken` varchar(64) NULL,
  ADD COLUMN `passwordResetExpiresAt` timestamp NULL;
--> statement-breakpoint

-- ─── clinics: rename subscription tier enum values ───────────────────────────
-- Old values: starter, standard, premium, enterprise
-- New values: free, clinic, pro
-- Migrate existing data first, then change the column definition.
UPDATE `clinics` SET `subscriptionTier` = 'pro'    WHERE `subscriptionTier` IN ('premium', 'enterprise');
UPDATE `clinics` SET `subscriptionTier` = 'clinic' WHERE `subscriptionTier` = 'standard';
UPDATE `clinics` SET `subscriptionTier` = 'free'   WHERE `subscriptionTier` = 'starter' OR `subscriptionTier` IS NULL;
--> statement-breakpoint
ALTER TABLE `clinics`
  MODIFY COLUMN `subscriptionTier`
  enum('free','clinic','pro') DEFAULT 'free';
--> statement-breakpoint

-- ─── clinics: add subscription + branch + owner columns ──────────────────────
ALTER TABLE `clinics`
  ADD COLUMN `ownerId` int NULL,
  ADD COLUMN `trialEndsAt` timestamp NULL,
  ADD COLUMN `gracePeriodEndsAt` timestamp NULL,
  ADD COLUMN `lsCustomerId` varchar(100) NULL,
  ADD COLUMN `lsSubscriptionId` varchar(100) NULL,
  ADD COLUMN `subscriptionRenewsAt` timestamp NULL;
--> statement-breakpoint

-- ─── patients: add flags, smsOptOut ──────────────────────────────────────────
ALTER TABLE `patients`
  ADD COLUMN `flags` varchar(255) NULL,
  ADD COLUMN `smsOptOut` boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Change patientId from a global unique to a per-clinic composite unique.
-- First drop the old global unique constraint (name comes from 0001 migration).
ALTER TABLE `patients` DROP INDEX `patients_patientId_unique`;
--> statement-breakpoint
-- Add composite unique: patientId is unique within each clinic, not globally.
ALTER TABLE `patients`
  ADD CONSTRAINT `patients_clinicId_patientId_unique`
  UNIQUE (`clinicId`, `patientId`);
--> statement-breakpoint

-- ─── visits: add prescriptionNotes, followUpFlag, followUpDate ───────────────
-- Also expand status enum to include 'open' and 'in_progress'.
-- MySQL requires recreating the column type to add enum values.
ALTER TABLE `visits`
  ADD COLUMN `prescriptionNotes` text NULL,
  ADD COLUMN `followUpFlag` boolean NOT NULL DEFAULT false,
  ADD COLUMN `followUpDate` date NULL;
--> statement-breakpoint
-- Expand visit status enum (MySQL requires MODIFY COLUMN to add new enum values)
ALTER TABLE `visits`
  MODIFY COLUMN `status`
  enum('pending','open','in_progress','completed','cancelled') DEFAULT 'completed';
--> statement-breakpoint

-- ─── smsNotifications: add 'payment_reminder' to messageType enum ────────────
ALTER TABLE `smsNotifications`
  MODIFY COLUMN `messageType`
  enum('appointment_reminder','payment_receipt','payment_reminder','low_stock_alert','visit_confirmation') NOT NULL;
--> statement-breakpoint

-- ─── bills: change billNumber from global unique to per-clinic composite unique ─
-- Drop the old global unique constraint.
ALTER TABLE `bills` DROP INDEX `bills_billNumber_unique`;
--> statement-breakpoint
-- Add composite unique: billNumber is unique within each clinic, not globally.
ALTER TABLE `bills`
  ADD CONSTRAINT `bills_clinicId_billNumber_unique`
  UNIQUE (`clinicId`, `billNumber`);
--> statement-breakpoint

-- ─── New table: otpCodes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `otpCodes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `phone` varchar(20) NOT NULL,
  `codeHash` varchar(255) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `otpCodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint

-- ─── New table: invites ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `invites` (
  `id` int AUTO_INCREMENT NOT NULL,
  `clinicId` int NOT NULL,
  `email` varchar(320) NULL,
  `phone` varchar(20) NULL,
  `role` enum('receptionist','doctor','manager') NOT NULL,
  `token` varchar(64) NOT NULL,
  `invitedBy` int NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `invites_id` PRIMARY KEY(`id`),
  CONSTRAINT `invites_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint

-- ─── New table: serviceTemplates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `serviceTemplates` (
  `id` int AUTO_INCREMENT NOT NULL,
  `clinicId` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `category` enum('consultation','lab','drug','other') NOT NULL DEFAULT 'other',
  `price` decimal(10,2) NOT NULL,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `serviceTemplates_id` PRIMARY KEY(`id`)
);
