-- subscriptionEvents: churn tracking + billing-issue visibility for the
-- Owner Dashboard. Previously the LemonSqueezy webhook only console.error'd
-- edge cases (unrecognised variant_id, etc.) — invisible unless someone was
-- tailing Render logs at that exact moment. This also backs churn stats
-- (query by eventType) since there was no historical record of
-- downgrades/cancellations before this, only the clinic's current state.

-- NOTE: this file originally shipped in MySQL syntax (backtick identifiers,
-- ENUM(...), AUTO_INCREMENT) despite the project running on Postgres/Supabase
-- — a leftover from an earlier MySQL migration that was never fully ported.
-- It would have failed outright if ever run against Postgres. The table
-- below already exists in production (applied directly via `drizzle-kit
-- push`, bypassing this file), so this rewrite is CREATE TABLE IF NOT
-- EXISTS — it brings the migration history in line with reality without
-- trying to re-create anything that's already there.

DO $$ BEGIN
  CREATE TYPE "public"."subscription_event_type" AS ENUM ('upgraded','downgraded','cancelled','payment_failed','needs_review');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."subscriptionEvents" (
  "id" serial PRIMARY KEY,
  "clinicId" integer NOT NULL,
  "eventType" "public"."subscription_event_type" NOT NULL,
  "fromTier" varchar(20),
  "toTier" varchar(20),
  "note" text,
  "needsReview" boolean NOT NULL DEFAULT false,
  "resolvedAt" timestamp,
  "resolvedByUserId" integer,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptionEvents_clinicId" ON "public"."subscriptionEvents" ("clinicId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptionEvents_needsReview" ON "public"."subscriptionEvents" ("needsReview");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptionEvents_createdAt" ON "public"."subscriptionEvents" ("createdAt");
