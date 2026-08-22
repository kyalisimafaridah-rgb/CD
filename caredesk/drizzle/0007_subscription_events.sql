-- subscriptionEvents: churn tracking + billing-issue visibility for the
-- Owner Dashboard. Previously the LemonSqueezy webhook only console.error'd
-- edge cases (unrecognised variant_id, etc.) — invisible unless someone was
-- tailing Render logs at that exact moment. This also backs churn stats
-- (query by eventType) since there was no historical record of
-- downgrades/cancellations before this, only the clinic's current state.

CREATE TABLE `subscriptionEvents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `clinicId` INT NOT NULL,
  `eventType` ENUM('upgraded','downgraded','cancelled','payment_failed','needs_review') NOT NULL,
  `fromTier` VARCHAR(20),
  `toTier` VARCHAR(20),
  `note` TEXT,
  `needsReview` BOOLEAN NOT NULL DEFAULT FALSE,
  `resolvedAt` TIMESTAMP NULL,
  `resolvedByUserId` INT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_subscriptionEvents_clinicId` ON `subscriptionEvents` (`clinicId`);
--> statement-breakpoint
CREATE INDEX `idx_subscriptionEvents_needsReview` ON `subscriptionEvents` (`needsReview`);
--> statement-breakpoint
CREATE INDEX `idx_subscriptionEvents_createdAt` ON `subscriptionEvents` (`createdAt`);
