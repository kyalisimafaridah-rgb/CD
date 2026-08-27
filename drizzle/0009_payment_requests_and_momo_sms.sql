-- Reconciliation migration: subscriptionPaymentRequests and momoSmsEvents
-- both already exist in production (subscriptionPaymentRequests was applied
-- directly via `drizzle-kit push` at some point with no tracked migration
-- file; momoSmsEvents was applied by hand via the Supabase connector on
-- 2026-08-25 to unblock the v24 MoMo SMS auto-billing deploy). Neither had
-- a corresponding file here, so `drizzle-kit generate` had no way to know
-- they already existed. Written IF NOT EXISTS so it's a no-op against
-- caredesk-production and only does real work on a fresh database (new dev
-- environment, disaster recovery, etc).

DO $$ BEGIN
  CREATE TYPE "public"."payment_request_status" AS ENUM ('pending','approved','rejected','cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."subscriptionPaymentRequests" (
  "id" serial PRIMARY KEY,
  "clinicId" integer NOT NULL,
  "requestedByUserId" integer NOT NULL,
  "tier" "public"."subscription_tier" NOT NULL,
  "durationMonths" integer NOT NULL,
  "amountUgx" integer NOT NULL,
  "payerPhone" varchar(120) NOT NULL,
  "mtnTransactionId" varchar(64),
  "note" text,
  "status" "public"."payment_request_status" NOT NULL DEFAULT 'pending',
  "reviewedByUserId" integer,
  "reviewedAt" timestamp,
  "reviewNote" text,
  "appliedUntil" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."momo_sms_event_status" AS ENUM ('matched','no_match','ambiguous','duplicate','parse_failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."momoSmsEvents" (
  "id" serial PRIMARY KEY,
  "rawBody" text NOT NULL,
  "network" varchar(20),
  "transactionId" varchar(64),
  "parsedAmountUgx" integer,
  "parsedReasonName" varchar(160),
  "parsedReasonPhone" varchar(30),
  "status" "public"."momo_sms_event_status" NOT NULL,
  "matchedPaymentRequestId" integer,
  "matchedClinicId" integer,
  "note" text,
  "resolvedAt" timestamp,
  "resolvedByUserId" integer,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "momoSmsEvents_transactionId_unique" ON "public"."momoSmsEvents" ("transactionId");
