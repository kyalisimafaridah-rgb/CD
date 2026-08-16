-- Offline-first sync support.
--
-- Every write that can originate from a device that was offline needs a
-- client-generated idempotency key. Without this, replaying a queued
-- mutation after a flaky connection (request succeeded server-side but the
-- response never reached the device) creates a duplicate patient, visit,
-- appointment, or payment. The unique index makes retries safe: the second
-- attempt with the same key is detected and the original result is
-- returned instead of inserting twice.
--
-- clientMutationId is a UUID generated on-device at the moment the user
-- taps "save", before we know whether we're online. It travels with the
-- mutation whether it's sent immediately or queued in the outbox.

ALTER TABLE `patients` ADD COLUMN `clientMutationId` VARCHAR(36) NULL;
--> statement-breakpoint
ALTER TABLE `visits` ADD COLUMN `clientMutationId` VARCHAR(36) NULL;
--> statement-breakpoint
ALTER TABLE `appointments` ADD COLUMN `clientMutationId` VARCHAR(36) NULL;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `clientMutationId` VARCHAR(36) NULL;
--> statement-breakpoint

-- Unique but nullable: MySQL allows multiple NULLs through a unique index,
-- so rows created before this migration (or via server-side/admin paths
-- that don't go through the offline queue) are unaffected.
CREATE UNIQUE INDEX `patients_clientMutationId_unique` ON `patients` (`clientMutationId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `visits_clientMutationId_unique` ON `visits` (`clientMutationId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_clientMutationId_unique` ON `appointments` (`clientMutationId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_clientMutationId_unique` ON `payments` (`clientMutationId`);
