-- Migration 0005: real isVoided flag for bills
-- Previously a voided bill was signalled by prefixing `notes` with
-- "VOIDED:" and zeroing every amount, with paymentStatus left as "paid" so
-- it wouldn't count in revenue reports. The client detected this via
-- notes?.startsWith("VOIDED:") — fragile, and easy to break by touching
-- notes anywhere else. Add a real boolean and backfill it from the old
-- convention so existing voided bills aren't lost.

ALTER TABLE `bills`
  ADD COLUMN `isVoided` boolean NOT NULL DEFAULT false;

UPDATE `bills` SET `isVoided` = true WHERE `notes` LIKE 'VOIDED:%';
