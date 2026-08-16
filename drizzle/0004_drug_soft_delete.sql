-- Migration 0004: soft-delete for drugs
-- Previously drug.delete did a hard DELETE, which could orphan
-- drugStockHistory rows (drugId has no FK constraint) and permanently erase
-- a drug that appears in past visit prescriptions' history. Add isActive so
-- deleteDrug can flip a flag instead, matching the pattern already used for
-- patients.

ALTER TABLE `drugs`
  ADD COLUMN `isActive` boolean NOT NULL DEFAULT true;
