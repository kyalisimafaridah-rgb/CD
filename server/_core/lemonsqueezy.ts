import { createHmac, timingSafeEqual } from "crypto";
import { ENV } from "./env";
import * as db from "../db";
import { type SubscriptionTier } from "../../shared/tiers";
import { normaliseTier } from "../subscription";
import { sendEmail, escapeHtml } from "../email";

/**
 * Fires an email to every active platform admin so a billing edge case
 * (unrecognised variant_id, failed payment) is actually seen in real time
 * instead of sitting invisible until someone opens Owner Dashboard. Never
 * throws — a notification failure shouldn't fail the webhook handler
 * itself, since the underlying billing state change has already been
 * written to the DB by the time this runs.
 */
async function alertAdminsOfBillingIssue(subject: string, detail: string): Promise<void> {
  try {
    const emails = await db.getAdminEmails();
    if (emails.length === 0) return;
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#dc2626;">⚠️ ${escapeHtml(subject)}</h2>
      <p>${escapeHtml(detail)}</p>
      <p style="font-size:12px;color:#6b7280;">Check Owner Dashboard → Billing issues for details.</p>
    </div>`;
    await Promise.all(emails.map((to) => sendEmail({ to, subject: `[CareDesk] ${subject}`, html })));
  } catch (error) {
    console.warn("[Lemonsqueezy] Failed to alert admins of billing issue:", error);
  }
}

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Maps a Lemonsqueezy variant ID to a CareDesk subscription tier.
 * Returns null when the tier can't be confidently determined (no variant_id
 * on the event, or it doesn't match either configured variant) — callers
 * decide the right fallback for their event type. Do NOT default this to
 * "free": for renewal/update events that already have a paying clinic on
 * the other end, "free" is a silent downgrade, not a safe default.
 */
function tierFromVariantId(variantId: string | undefined): SubscriptionTier | null {
  if (!variantId) return null;
  if (ENV.lemonVariantPro && variantId === ENV.lemonVariantPro) return "pro";
  if (ENV.lemonVariantClinic && variantId === ENV.lemonVariantClinic) return "clinic";
  return null;
}

/**
 * Verifies a Lemonsqueezy webhook's X-Signature header against the raw
 * request body using HMAC-SHA256. Fails closed (returns false) if the
 * webhook secret isn't configured or the signature is missing/malformed.
 */
export function verifyLemonSqueezySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!ENV.lemonSqueezyWebhookSecret || !signatureHeader) return false;

  const expected = createHmac("sha256", ENV.lemonSqueezyWebhookSecret).update(rawBody).digest("hex");

  let expectedBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, "hex");
    actualBuf = Buffer.from(signatureHeader, "hex");
  } catch {
    return false;
  }

  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

type LemonSqueezyEvent = {
  meta?: { event_name?: string; custom_data?: Record<string, unknown> };
  data?: { id?: string; attributes?: Record<string, unknown> };
};

/**
 * Applies a verified Lemonsqueezy webhook event to the clinics table.
 *
 * Subscription matching:
 *  - subscription_created: matched via meta.custom_data.clinic_id
 *  - All other events: matched via the stored lsSubscriptionId
 *
 * Tier detection: each event carries a variant_id in data.attributes.
 * This is matched against LEMON_VARIANT_CLINIC and LEMON_VARIANT_PRO
 * env vars to determine which plan the clinic is on.
 */
export async function handleLemonSqueezyWebhook(event: LemonSqueezyEvent): Promise<void> {
  const eventName = event.meta?.event_name;
  const subscriptionId = event.data?.id;
  const attrs = event.data?.attributes ?? {};
  const renewsAtRaw = attrs.renews_at;
  const renewsAt = typeof renewsAtRaw === "string" ? new Date(renewsAtRaw) : null;
  const customerIdRaw = attrs.customer_id;
  const customerId = customerIdRaw !== undefined && customerIdRaw !== null ? String(customerIdRaw) : undefined;
  const variantId = attrs.variant_id !== undefined ? String(attrs.variant_id) : undefined;

  switch (eventName) {
    case "subscription_created": {
      const clinicIdRaw = event.meta?.custom_data?.clinic_id;
      const clinicId = clinicIdRaw !== undefined ? Number(clinicIdRaw) : NaN;
      if (!subscriptionId || Number.isNaN(clinicId)) {
        console.warn("[Lemonsqueezy] subscription_created missing subscription id or custom_data.clinic_id");
        return;
      }

      const detectedTier = tierFromVariantId(variantId);
      // Someone just paid — if we can't positively identify which plan from
      // the variant_id, do NOT default to "free". That was the one case in
      // this file that still did (every other case below already refuses to).
      // A customer who just completed checkout ending up on "free" because
      // env vars drifted from LemonSqueezy's variant IDs is a billing bug,
      // not a safe fallback. Record the subscription id and customer id so
      // the account is at least linked, but leave the tier untouched (it
      // starts at "free" on registration) and flag it loudly for follow-up.
      if (!detectedTier) {
        console.error(
          `[Lemonsqueezy] subscription_created for clinic ${clinicId} with unrecognised variant_id="${variantId}" — ` +
          `NOT auto-upgrading. Check LEMON_VARIANT_CLINIC/LEMON_VARIANT_PRO env vars against this variant and fix manually.`
        );
        await db.logSubscriptionEvent({
          clinicId,
          eventType: "needs_review",
          note: `subscription_created with unrecognised variant_id="${variantId}" — customer paid but tier could not be auto-detected. Subscription id ${subscriptionId} was linked; correct the tier manually.`,
          needsReview: true,
        });
        void alertAdminsOfBillingIssue(
          "A customer paid but wasn't auto-upgraded",
          `Clinic ${clinicId}'s subscription_created webhook carried an unrecognised variant_id ("${variantId}"). ` +
          `They've been charged but are still on their old tier — check LEMON_VARIANT_CLINIC/LEMON_VARIANT_PRO and correct the tier manually in Owner Dashboard.`
        );
        const linkOnly: Parameters<typeof db.updateClinicBillingInfo>[1] = {
          lsSubscriptionId: subscriptionId,
          subscriptionRenewsAt: renewsAt,
        };
        if (customerId !== undefined) linkOnly.lsCustomerId = customerId;
        await db.updateClinicBillingInfo(clinicId, linkOnly);
        return;
      }

      const tier = detectedTier;
      const updates: Parameters<typeof db.updateClinicBillingInfo>[1] = {
        subscriptionStatus: "active",
        subscriptionTier: tier,
        lsSubscriptionId: subscriptionId,
        subscriptionRenewsAt: renewsAt,
        gracePeriodEndsAt: null,
      };
      if (customerId !== undefined) updates.lsCustomerId = customerId;

      await db.updateClinicBillingInfo(clinicId, updates);
      await db.syncBranchTiersToOwner(clinicId, { subscriptionTier: tier, subscriptionStatus: "active" });
      await db.logSubscriptionEvent({ clinicId, eventType: "upgraded", fromTier: "free", toTier: tier });
      console.log(`[Lemonsqueezy] Clinic ${clinicId} activated on ${tier} plan`);
      return;
    }

    case "subscription_updated": {
      // Fires when a customer upgrades or downgrades their plan.
      if (!subscriptionId) return;
      const clinic = await db.getClinicByLsSubscriptionId(subscriptionId);
      if (!clinic) {
        console.warn("[Lemonsqueezy] subscription_updated for unknown subscription:", subscriptionId);
        return;
      }
      // A clinic already exists here with a real tier — if this particular event
      // doesn't carry a recognisable variant_id, preserve the current tier rather
      // than assuming "free". Downgrading a customer we can't positively identify
      // is the wrong failure direction (it revokes paid access on a parsing gap).
      const detectedTier = tierFromVariantId(variantId);
      const tier = detectedTier ?? normaliseTier(clinic.subscriptionTier);
      const previousTier = normaliseTier(clinic.subscriptionTier);
      await db.updateClinicBillingInfo(clinic.id, {
        subscriptionStatus: "active",
        subscriptionTier: tier,
        subscriptionRenewsAt: renewsAt,
        gracePeriodEndsAt: null,
      });
      await db.syncBranchTiersToOwner(clinic.id, { subscriptionTier: tier, subscriptionStatus: "active" });
      const tierRank = { free: 0, clinic: 1, pro: 2 } as const;
      if (tier !== previousTier) {
        await db.logSubscriptionEvent({
          clinicId: clinic.id,
          eventType: tierRank[tier] > tierRank[previousTier] ? "upgraded" : "downgraded",
          fromTier: previousTier,
          toTier: tier,
        });
      }
      console.log(`[Lemonsqueezy] Clinic ${clinic.id} updated to ${tier} plan`);
      return;
    }

    case "subscription_payment_success": {
      if (!subscriptionId) return;
      const clinic = await db.getClinicByLsSubscriptionId(subscriptionId);
      if (!clinic) {
        console.warn("[Lemonsqueezy] payment_success for unknown subscription:", subscriptionId);
        return;
      }
      // This fires on every renewal for every paying customer. Previously,
      // `tier || fallback` was dead code — tierFromVariantId() always returned a
      // truthy string ("free" included), so the fallback to the clinic's existing
      // tier could never actually run. Any renewal webhook missing variant_id (or
      // carrying an unrecognised one) silently reset the clinic to "free" — and if
      // ENFORCE_TRIAL_EXPIRY is ever turned on, that could fully lock out a paying
      // customer. Preserve the current tier whenever the event doesn't positively
      // identify a plan.
      const detectedTier = tierFromVariantId(variantId);
      const tier = detectedTier ?? normaliseTier(clinic.subscriptionTier);
      await db.updateClinicBillingInfo(clinic.id, {
        subscriptionStatus: "active",
        subscriptionTier: tier,
        subscriptionRenewsAt: renewsAt,
        gracePeriodEndsAt: null,
      });
      return;
    }

    case "subscription_payment_failed": {
      if (!subscriptionId) return;
      const clinic = await db.getClinicByLsSubscriptionId(subscriptionId);
      if (!clinic) {
        console.warn("[Lemonsqueezy] payment_failed for unknown subscription:", subscriptionId);
        return;
      }
      // 3-day grace period before full lockout
      await db.updateClinicBillingInfo(clinic.id, {
        subscriptionStatus: "suspended",
        gracePeriodEndsAt: new Date(Date.now() + GRACE_PERIOD_MS),
      });
      await db.syncBranchTiersToOwner(clinic.id, { subscriptionStatus: "suspended" });
      await db.logSubscriptionEvent({
        clinicId: clinic.id,
        eventType: "payment_failed",
        note: `Payment failed — 3-day grace period started, ends ${new Date(Date.now() + GRACE_PERIOD_MS).toLocaleDateString()}.`,
        needsReview: true,
      });
      void alertAdminsOfBillingIssue(
        `Payment failed — ${clinic.name}`,
        `${clinic.name}'s subscription payment failed. They're in a 3-day grace period ending ` +
        `${new Date(Date.now() + GRACE_PERIOD_MS).toLocaleDateString()}, after which they'll be suspended automatically.`
      );
      return;
    }

    case "subscription_cancelled":
    case "subscription_expired": {
      if (!subscriptionId) return;
      const clinic = await db.getClinicByLsSubscriptionId(subscriptionId);
      if (!clinic) {
        console.warn(`[Lemonsqueezy] ${eventName} for unknown subscription:`, subscriptionId);
        return;
      }
      // Drop back to free tier on cancellation — data stays, features locked
      const previousTier = normaliseTier(clinic.subscriptionTier);
      await db.updateClinicBillingInfo(clinic.id, {
        subscriptionStatus: "active",
        subscriptionTier: "free",
        gracePeriodEndsAt: null,
      });
      await db.syncBranchTiersToOwner(clinic.id, { subscriptionTier: "free", subscriptionStatus: "active" });
      await db.logSubscriptionEvent({
        clinicId: clinic.id,
        eventType: "cancelled",
        fromTier: previousTier,
        toTier: "free",
        note: eventName,
      });
      console.log(`[Lemonsqueezy] Clinic ${clinic.id} cancelled — downgraded to free`);
      return;
    }

    default:
      return;
  }
}
