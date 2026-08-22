import { ENV } from "./_core/env";
import type { Clinic } from "../drizzle/schema";
import { type SubscriptionTier, TIER_LIMITS } from "../shared/tiers";

export type AccessWarning =
  | "grace_period"
  | "trial_ending"
  | "subscription_ending"
  | "subscription_expired";

export type ClinicAccessStatus =
  | {
      allowed: true;
      /** Effective tier for limits/features (paid period may have expired → free) */
      tier: SubscriptionTier;
      warning?: AccessWarning;
      gracePeriodEndsAt?: Date;
      trialEndsAt?: Date;
      subscriptionRenewsAt?: Date | null;
      /** True when DB still says paid but period has ended (lazy downgrade pending) */
      paidPeriodExpired?: boolean;
    }
  | { allowed: false; reason: "suspended" | "trial_expired" };

const TRIAL_WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
/** Warn managers this long before subscriptionRenewsAt */
export const SUBSCRIPTION_WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Normalises the raw DB tier value to one of the three canonical tiers.
 */
export function normaliseTier(raw: string | null | undefined): SubscriptionTier {
  if (raw === "clinic" || raw === "pro") return raw;
  if (raw === "premium" || raw === "enterprise") return "pro";
  if (raw === "standard") return "clinic";
  return "free";
}

export function getClinicTierLimits(tier: SubscriptionTier) {
  return TIER_LIMITS[tier];
}

type ClinicSubFields = Pick<
  Clinic,
  "subscriptionStatus" | "subscriptionTier" | "gracePeriodEndsAt" | "trialEndsAt" | "subscriptionRenewsAt"
>;

/**
 * Whether a paid tier's prepaid period is still valid.
 * - No renewsAt on a paid tier → treat as still paid (manual admin grant).
 * - renewsAt in the future → paid.
 * - renewsAt in the past → expired → effective free.
 */
export function isPaidPeriodActive(clinic: ClinicSubFields | null | undefined): boolean {
  if (!clinic) return false;
  const stored = normaliseTier(clinic.subscriptionTier);
  if (stored === "free") return false;
  if (!clinic.subscriptionRenewsAt) return true; // manual / legacy paid without end date
  return clinic.subscriptionRenewsAt.getTime() > Date.now();
}

/**
 * Effective tier used for limits and feature gates.
 * Expired prepaid periods resolve to free without requiring a DB write first.
 */
export function getEffectiveTier(clinic: ClinicSubFields | null | undefined): SubscriptionTier {
  if (!clinic) return "free";
  const stored = normaliseTier(clinic.subscriptionTier);
  if (stored === "free") return "free";
  if (!isPaidPeriodActive(clinic)) return "free";
  return stored;
}

/**
 * Access + effective tier + warnings for banners.
 * Does not write to the DB — call ensurePaidPeriodEnforced for persistence.
 */
export function getClinicAccessStatus(clinic: ClinicSubFields): ClinicAccessStatus {
  const now = Date.now();
  const storedTier = normaliseTier(clinic.subscriptionTier);
  const effectiveTier = getEffectiveTier(clinic);
  const paidPeriodExpired = storedTier !== "free" && !isPaidPeriodActive(clinic);

  if (clinic.subscriptionStatus === "suspended") {
    const graceEndsAt = clinic.gracePeriodEndsAt;
    if (graceEndsAt && graceEndsAt.getTime() > now) {
      return {
        allowed: true,
        tier: effectiveTier,
        warning: "grace_period",
        gracePeriodEndsAt: graceEndsAt,
        subscriptionRenewsAt: clinic.subscriptionRenewsAt,
        paidPeriodExpired,
      };
    }
    return { allowed: false, reason: "suspended" };
  }

  // Prepaid period ended → still allowed on free tier (not locked out)
  if (paidPeriodExpired) {
    return {
      allowed: true,
      tier: "free",
      warning: "subscription_expired",
      subscriptionRenewsAt: clinic.subscriptionRenewsAt,
      paidPeriodExpired: true,
    };
  }

  // Active paid subscription — optional ending-soon warning
  if (storedTier !== "free" && clinic.subscriptionRenewsAt) {
    const renewsMs = clinic.subscriptionRenewsAt.getTime();
    if (renewsMs > now && renewsMs - now <= SUBSCRIPTION_WARNING_WINDOW_MS) {
      return {
        allowed: true,
        tier: effectiveTier,
        warning: "subscription_ending",
        subscriptionRenewsAt: clinic.subscriptionRenewsAt,
      };
    }
    return {
      allowed: true,
      tier: effectiveTier,
      subscriptionRenewsAt: clinic.subscriptionRenewsAt,
    };
  }

  // Free tier — trial rules
  if (clinic.trialEndsAt) {
    const trialEndsAtMs = clinic.trialEndsAt.getTime();
    const trialExpired = trialEndsAtMs <= now;

    if (trialExpired && ENV.enforceTrialExpiry) {
      return { allowed: false, reason: "trial_expired" };
    }

    const withinWarningWindow = !trialExpired && trialEndsAtMs - now <= TRIAL_WARNING_WINDOW_MS;
    if (withinWarningWindow) {
      return {
        allowed: true,
        tier: "free",
        warning: "trial_ending",
        trialEndsAt: clinic.trialEndsAt,
        subscriptionRenewsAt: clinic.subscriptionRenewsAt,
      };
    }
  }

  return {
    allowed: true,
    tier: effectiveTier,
    subscriptionRenewsAt: clinic.subscriptionRenewsAt,
  };
}
