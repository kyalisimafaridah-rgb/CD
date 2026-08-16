import { ENV } from "./_core/env";
import type { Clinic } from "../drizzle/schema";
import { type SubscriptionTier, TIER_LIMITS } from "../shared/tiers";

export type ClinicAccessStatus =
  | { allowed: true; tier: SubscriptionTier; warning?: "grace_period" | "trial_ending"; gracePeriodEndsAt?: Date; trialEndsAt?: Date }
  | { allowed: false; reason: "suspended" | "trial_expired" };

const TRIAL_WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Normalises the raw DB tier value to one of the three canonical tiers.
 * Old values from before the tier rename (starter/standard/premium/enterprise)
 * are mapped forward so existing clinics don't lose access.
 */
export function normaliseTier(raw: string | null | undefined): SubscriptionTier {
  if (raw === "clinic" || raw === "pro") return raw;
  // Legacy values from old schema — map to nearest equivalent
  if (raw === "premium" || raw === "enterprise") return "pro";
  if (raw === "standard") return "clinic";
  return "free"; // starter, null, undefined, unknown
}

/**
 * Returns the TierLimits for a clinic's current tier.
 */
export function getClinicTierLimits(tier: SubscriptionTier) {
  return TIER_LIMITS[tier];
}

/**
 * Determines whether a clinic's users currently have access to the app,
 * which tier they are on, and whether a warning banner should be shown.
 */
export function getClinicAccessStatus(
  clinic: Pick<Clinic, "subscriptionStatus" | "subscriptionTier" | "gracePeriodEndsAt" | "trialEndsAt">
): ClinicAccessStatus {
  const now = Date.now();
  const tier = normaliseTier(clinic.subscriptionTier);

  if (clinic.subscriptionStatus === "suspended") {
    const graceEndsAt = clinic.gracePeriodEndsAt;
    if (graceEndsAt && graceEndsAt.getTime() > now) {
      return { allowed: true, tier, warning: "grace_period", gracePeriodEndsAt: graceEndsAt };
    }
    return { allowed: false, reason: "suspended" };
  }

  if (clinic.trialEndsAt) {
    const trialEndsAtMs = clinic.trialEndsAt.getTime();
    const trialExpired = trialEndsAtMs <= now;

    // Only enforce/warn about trial expiry for free-tier clinics.
    // Paid clinics have a real subscription — their trialEndsAt is historical.
    if (tier !== "free") {
      return { allowed: true, tier };
    }

    if (trialExpired && ENV.enforceTrialExpiry) {
      return { allowed: false, reason: "trial_expired" };
    }

    // Only warn inside the real pre-expiry window. Once the date has passed
    // with enforcement off, the free tier is — correctly — just permanent;
    // continuing to show "trial ending" every day after day 14 was a false
    // alarm that contradicted the product's own "permanent free tier"
    // positioning (see welcome email, landing page copy).
    const withinWarningWindow = !trialExpired && trialEndsAtMs - now <= TRIAL_WARNING_WINDOW_MS;
    if (withinWarningWindow) {
      return { allowed: true, tier, warning: "trial_ending", trialEndsAt: clinic.trialEndsAt };
    }
  }

  return { allowed: true, tier };
}
