/**
 * CareDesk subscription tiers — single source of truth.
 *
 * Free    $0/month  — 1 staff, 30 new patients/month, 30 visits/month, 1 branch
 * Clinic  UGX 90,000/month  — 5 staff, unlimited patients, unlimited visits, 1 branch, SMS logs, reports
 * Pro     UGX 180,000/month — unlimited staff, unlimited patients, unlimited visits, unlimited branches, all features
 *
 * Free has TWO independent monthly caps: new patient registrations, and visits
 * logged (any patient, whether registered this month or years ago). Capping
 * only registrations lets a clinic with a small, stable patient base run
 * unlimited paid consultations through the free tier forever — the visit cap
 * closes that gap and ties the limit to actual clinic activity, not just
 * roster growth.
 *
 * Import this on both server and client. Never hardcode limits elsewhere.
 */

export type SubscriptionTier = "free" | "clinic" | "pro";

export interface TierLimits {
  /** Maximum active staff members (owner counts as 1) */
  maxStaff: number;
  /** Maximum new patients registered per calendar month. null = unlimited */
  maxPatientsPerMonth: number | null;
  /** Maximum visits logged per calendar month, across ALL patients (new or
   *  pre-existing). null = unlimited. Independent from maxPatientsPerMonth —
   *  either cap can block further action on its own. */
  maxVisitsPerMonth: number | null;
  /** Maximum clinic branches. null = unlimited */
  maxBranches: number | null;
  /** Whether SMS logs are visible */
  smsLogs: boolean;
  /** Whether activity audit log is visible */
  activityLog: boolean;
  /** Whether revenue / reconciliation reports are available */
  reports: boolean;
  /** Whether debt reminders can be sent */
  debtReminders: boolean;
  /** Whether drug inventory management is available */
  drugInventory: boolean;
  /** Human-readable price label */
  priceLabel: string;
  /** Price in USD cents per month */
  priceUsdCents: number;
  /** Price in UGX per month — the currency actually charged (MTN MoMo self-service) */
  priceUgx: number;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    maxStaff: 1,
    maxPatientsPerMonth: 30,
    maxVisitsPerMonth: 30,
    maxBranches: 1,
    smsLogs: false,
    activityLog: false,
    reports: false,
    debtReminders: false,
    drugInventory: false,
    priceLabel: "Free",
    priceUsdCents: 0,
    priceUgx: 0,
  },
  clinic: {
    maxStaff: 5,
    maxPatientsPerMonth: null,
    maxVisitsPerMonth: null,
    maxBranches: 1,
    smsLogs: true,
    activityLog: true,
    reports: true,
    debtReminders: true,
    drugInventory: true,
    priceLabel: "UGX 90,000 / month",
    priceUsdCents: 2500,
    priceUgx: 90_000,
  },
  pro: {
    maxStaff: null as unknown as number,   // unlimited — check via maxStaffUnlimited
    maxPatientsPerMonth: null,
    maxVisitsPerMonth: null,
    maxBranches: null,
    smsLogs: true,
    activityLog: true,
    reports: true,
    debtReminders: true,
    drugInventory: true,
    priceLabel: "UGX 180,000 / month",
    priceUsdCents: 5000,
    priceUgx: 180_000,
  },
};

/** Returns true if the tier allows unlimited staff */
export function hasUnlimitedStaff(tier: SubscriptionTier): boolean {
  return tier === "pro";
}

/** Returns true if the tier allows unlimited branches */
export function hasUnlimitedBranches(tier: SubscriptionTier): boolean {
  return tier === "pro";
}

/** Returns true if the tier has unlimited patients per month */
export function hasUnlimitedPatients(tier: SubscriptionTier): boolean {
  return tier === "clinic" || tier === "pro";
}

/** Returns true if the tier has unlimited visits per month */
export function hasUnlimitedVisits(tier: SubscriptionTier): boolean {
  return tier === "clinic" || tier === "pro";
}

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: "Free",
  clinic: "Clinic",
  pro: "Pro",
};

/** Human-readable feature list per tier for the upgrade UI */
export const TIER_FEATURES: Record<SubscriptionTier, string[]> = {
  free: [
    "1 staff member",
    "30 new patients per month",
    "30 visits per month",
    "1 branch",
    "Billing & invoicing",
    "Basic patient records",
    "Appointments",
  ],
  clinic: [
    "Up to 5 staff members",
    "Unlimited patients",
    "1 branch",
    "Drug inventory management",
    "SMS logs & activity audit",
    "Revenue reports & reconciliation",
    "Debt reminders via SMS",
  ],
  pro: [
    "Unlimited staff",
    "Unlimited patients",
    "Unlimited branches & locations",
    "All Clinic features",
    "Bulk SMS appointment reminders",
    "Multi-branch management",
  ],
};

/**
 * Parses a TIER_LIMIT_* error message from the server into a human-readable
 * upgrade prompt. Server sends: "TIER_LIMIT_PATIENTS:30:free" |
 * "TIER_LIMIT_VISITS:30:free" | "TIER_LIMIT_STAFF:1:free" |
 * "TIER_LIMIT_BRANCHES:1:clinic" | "TIER_LIMIT_FEATURE:reports:clinic"
 *
 * Originally lived only in main.tsx wired to react-query's mutation cache —
 * but useOfflineMutation (used by Patients/Visits/Appointments/Billing for
 * offline support) calls the vanilla tRPC client directly and never touches
 * react-query's mutation system, so those four screens were silently
 * showing the raw untranslated code instead of this message. Extracted here
 * so both paths use the same logic instead of one silently missing it.
 */
export function parseTierError(message: string): string | null {
  if (!message.startsWith("TIER_LIMIT_")) return null;
  const parts = message.split(":");
  const kind = parts[0].replace("TIER_LIMIT_", "");
  const limitRaw = parts[1] ?? "";
  switch (kind) {
    case "PATIENTS":
      return `You've reached the ${limitRaw}-patient monthly limit on the Free plan. Upgrade to Clinic (UGX 90,000/mo) for unlimited patients.`;
    case "VISITS":
      return `You've reached the ${limitRaw}-visit monthly limit on the Free plan. Upgrade to Clinic (UGX 90,000/mo) for unlimited visits.`;
    case "STAFF":
      return `You've reached the ${limitRaw}-staff limit on your current plan. Upgrade to invite more team members.`;
    case "BRANCHES":
      return `Multi-branch support requires the Pro plan (UGX 180,000/mo). Upgrade in Settings.`;
    case "FEATURE": {
      const features: Record<string, string> = {
        smsLogs: "SMS logs are available on the Clinic plan (UGX 90,000/mo) and above.",
        activityLog: "The activity audit log is available on the Clinic plan (UGX 90,000/mo) and above.",
        reports: "Revenue reports & reconciliation require the Clinic plan (UGX 90,000/mo) or above.",
        debtReminders: "Debt reminders via SMS require the Clinic plan (UGX 90,000/mo) or above.",
        drugInventory: "Drug inventory management requires the Clinic plan (UGX 90,000/mo). Upgrade in Settings.",
      };
      return features[limitRaw] ?? "This feature requires a higher plan. Upgrade in Settings.";
    }
    default:
      return "Your plan limit has been reached. Upgrade in Settings → Subscription.";
  }
}
