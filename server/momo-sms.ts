import * as db from "./db";
import { getEffectiveTier } from "./subscription";

/**
 * Parsing + matching + auto-approval for inbound "money received" SMS from
 * MTN MobileMoney / Airtel Money, relayed here by the phone-side listener
 * app (see /android-relay) hitting POST /api/webhooks/momo-sms.
 *
 * IMPORTANT — the matching design depends on one real-world constraint that
 * has to be communicated to every clinic manager, not just encoded in code:
 * the Reason field below is only reliably populated when the payer sends
 * money themselves via *165# or the MoMo app from their own phone. Payments
 * routed through a MoMo agent do not carry a usable reference. Clinics MUST
 * be told (in the upgrade instructions / Settings copy) to pay from their
 * own phone, not via an agent, or auto-approval silently falls through to
 * "no_match" and needs a manual admin click anyway.
 */

export type ParsedMomoSms = {
  network: "mtn" | "airtel";
  amountUgx: number;
  reasonName: string;
  reasonPhone: string | null;
  transactionId: string;
};

/**
 * MTN format (confirmed against a real SMS):
 * "You have received UGX 11000 from Airtel Money on 2026-08-21 12:06:14.
 *  fee:0. Reason: FARIDAH KYALISIIMA , 0743071148. New balance: UGX 11155.
 *  ID: 42919920590. ..."
 *
 * Note the sender network named in "from X Money" can be MTN or Airtel
 * regardless of which SIM received the SMS (interop) — `network` below
 * reflects which SIM/app the relay listener is watching, not this field.
 */
const MTN_RECEIVED_RE =
  /you have received ugx\s*([\d,]+)\s*from\s*.+?\bon\b.+?reason:\s*([^,]+?)\s*,\s*([\d+]{6,15})\D*new balance.*?\bid:\s*(\d+)/is;

/**
 * Fallback for a Reason field with no phone number at all (some MoMo app
 * sends carry only free text). Captured separately so a missing phone
 * doesn't fail the whole parse — reasonPhone becomes null and matching
 * falls back to name-only.
 */
const MTN_RECEIVED_NO_PHONE_RE =
  /you have received ugx\s*([\d,]+)\s*from\s*.+?\bon\b.+?reason:\s*([^.]+?)\.\s*new balance.*?\bid:\s*(\d+)/is;

/**
 * Airtel Money's own "received" SMS wording differs from MTN's. This is a
 * best-effort placeholder — confirm against a real Airtel-received SMS
 * (as opposed to the MTN SMS reporting an Airtel-originated transfer) and
 * tighten this regex before relying on it. Until then, unmatched Airtel
 * SMS fall through to parse_failed and show up in the review queue rather
 * than silently doing nothing.
 */
const AIRTEL_RECEIVED_RE =
  /you have received ugx\s*([\d,]+).+?from\s+([a-z\s]+?)[\s.]+(\d{6,15}).*?txid[:\s]*(\w+)/is;

export function parseMomoSms(rawBody: string, network: "mtn" | "airtel"): ParsedMomoSms | null {
  const text = rawBody.replace(/\s+/g, " ").trim();

  const mtnMatch = text.match(MTN_RECEIVED_RE);
  if (mtnMatch) {
    return {
      network,
      amountUgx: parseInt(mtnMatch[1].replace(/,/g, ""), 10),
      reasonName: mtnMatch[2].trim(),
      reasonPhone: mtnMatch[3].trim(),
      transactionId: mtnMatch[4].trim(),
    };
  }

  const mtnNoPhone = text.match(MTN_RECEIVED_NO_PHONE_RE);
  if (mtnNoPhone) {
    return {
      network,
      amountUgx: parseInt(mtnNoPhone[1].replace(/,/g, ""), 10),
      reasonName: mtnNoPhone[2].trim(),
      reasonPhone: null,
      transactionId: mtnNoPhone[3].trim(),
    };
  }

  const airtelMatch = text.match(AIRTEL_RECEIVED_RE);
  if (airtelMatch) {
    return {
      network,
      amountUgx: parseInt(airtelMatch[1].replace(/,/g, ""), 10),
      reasonName: airtelMatch[2].trim(),
      reasonPhone: airtelMatch[3].trim(),
      transactionId: airtelMatch[4].trim(),
    };
  }

  return null;
}

/** Loose match: strips punctuation/case so "Cisdatabun" matches "CISDATABUN ." etc. */
function normaliseForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function reasonMentionsClinicName(reasonName: string, clinicName: string): boolean {
  const reason = normaliseForMatch(reasonName);
  const clinic = normaliseForMatch(clinicName);
  if (clinic.length === 0) return false;
  return reason.includes(clinic) || clinic.includes(reason);
}

export type MomoSmsOutcome =
  | { status: "matched"; paymentRequestId: number; clinicId: number; tier: string; appliedUntil: Date }
  | { status: "no_match" }
  | { status: "ambiguous"; candidateIds: number[] }
  | { status: "duplicate"; existingEventId: number }
  | { status: "parse_failed" };

/**
 * End-to-end: parse -> log the raw event -> match -> auto-approve.
 * Every branch writes a momoSmsEvents row so nothing this endpoint sees is
 * ever silently dropped — "no_match" / "ambiguous" / "parse_failed" all
 * land in the admin review queue (Owner Dashboard -> Billing -> MoMo SMS).
 */
export async function processInboundMomoSms(rawBody: string, network: "mtn" | "airtel"): Promise<MomoSmsOutcome> {
  const parsed = parseMomoSms(rawBody, network);

  if (!parsed) {
    await db.createMomoSmsEvent({
      rawBody,
      network,
      status: "parse_failed",
    });
    return { status: "parse_failed" };
  }

  // Idempotency: MTN's own transaction ID is the hard dedup key. Reserve it
  // with a real INSERT right now — not just a check-then-later-insert,
  // which leaves a race window where two near-simultaneous webhook calls
  // for the same SMS (phone-side retry racing the original) could both
  // pass a pre-check, both match, and both auto-approve the same payment
  // twice. The unique index on momoSmsEvents.transactionId makes only one
  // of these inserts able to succeed; the loser catches the constraint
  // violation and bails out as "duplicate" before ever touching billing.
  let eventId: number;
  try {
    const created = await db.createMomoSmsEvent({
      rawBody,
      network,
      transactionId: parsed.transactionId,
      parsedAmountUgx: parsed.amountUgx,
      parsedReasonName: parsed.reasonName,
      parsedReasonPhone: parsed.reasonPhone,
      status: "no_match", // placeholder — overwritten below once the real outcome is known
    });
    eventId = created.id;
  } catch (err) {
    if (db.isDuplicateOnColumn(err, "transactionId")) {
      const existing = await db.getMomoSmsEventByTransactionId(parsed.transactionId);
      return { status: "duplicate", existingEventId: existing?.id ?? -1 };
    }
    throw err;
  }

  const candidates = await db.listPendingPaymentRequestsByAmount(parsed.amountUgx);

  // Need clinic names to compare against the Reason text — fetch each
  // candidate's clinic in parallel rather than N+1'ing sequentially.
  const withClinics = await Promise.all(
    candidates.map(async (req) => ({ req, clinic: await db.getClinicById(req.clinicId) }))
  );
  const matching = withClinics.filter(
    ({ clinic }) => clinic && reasonMentionsClinicName(parsed.reasonName, clinic.name)
  );

  if (matching.length === 0) {
    await db.updateMomoSmsEventStatus(eventId, {
      status: candidates.length === 0 ? "no_match" : "ambiguous",
      note:
        candidates.length === 0
          ? undefined
          : `${candidates.length} pending request(s) at this amount, none matched Reason text "${parsed.reasonName}"`,
    });
    return candidates.length === 0
      ? { status: "no_match" }
      : { status: "ambiguous", candidateIds: candidates.map((c) => c.id) };
  }

  if (matching.length > 1) {
    await db.updateMomoSmsEventStatus(eventId, {
      status: "ambiguous",
      note: `Reason "${parsed.reasonName}" matched ${matching.length} clinics at this amount: ${matching
        .map(({ clinic }) => clinic?.name)
        .join(", ")}`,
    });
    return { status: "ambiguous", candidateIds: matching.map(({ req }) => req.id) };
  }

  const { req } = matching[0];
  const result = await applyPaymentApproval({
    paymentRequestId: req.id,
    reviewedByUserId: req.requestedByUserId, // no admin actor for an auto-approval
    reviewNote: `Auto-approved via MoMo SMS match (MTN txn ${parsed.transactionId})`,
    subscriptionEventNote: `Payment request #${req.id} auto-approved via MoMo SMS (txn ${parsed.transactionId})`,
    activityAction: "AUTO_APPROVE_PAYMENT_REQUEST_MOMO_SMS",
    mtnTransactionId: parsed.transactionId,
  });

  await db.updateMomoSmsEventStatus(eventId, {
    status: "matched",
    matchedPaymentRequestId: req.id,
    matchedClinicId: req.clinicId,
  });

  return { status: "matched", paymentRequestId: req.id, clinicId: req.clinicId, tier: result.tier, appliedUntil: result.appliedUntil };
}

/**
 * Shared upgrade logic — the ONE place a payment request actually flips a
 * clinic's subscription on. Both the admin's manual "approve" click
 * (routers.ts billing.approvePaymentRequest) and the SMS auto-approve path
 * above call this, so there is exactly one implementation of "what happens
 * when a payment is confirmed" rather than two that can drift apart.
 *
 * reviewedByUserId is whoever gets credited/logged as having approved it —
 * the admin's own id for a manual click, or the clinic's requestedByUserId
 * for an auto-approval (there is no admin actor in that path).
 */
export async function applyPaymentApproval(params: {
  paymentRequestId: number;
  reviewedByUserId: number;
  reviewNote: string;
  subscriptionEventNote: string;
  activityAction: string;
  mtnTransactionId?: string;
}): Promise<{ tier: "free" | "clinic" | "pro"; appliedUntil: Date; clinicId: number }> {
  const { paymentRequestId, reviewedByUserId, reviewNote, subscriptionEventNote, activityAction, mtnTransactionId } = params;

  const req = await db.getPaymentRequestById(paymentRequestId);
  if (!req) throw new Error(`Payment request ${paymentRequestId} not found`);
  if (req.status !== "pending") throw new Error(`Payment request ${paymentRequestId} is already ${req.status}`);

  // Atomic claim — the real guard against double-approval. The check above
  // is just a fast, friendlier error message for the common case; this is
  // what actually prevents two concurrent callers (admin click racing an
  // SMS webhook retry) from both proceeding past this point.
  const claimed = await db.claimPendingPaymentRequest(paymentRequestId);
  if (!claimed) {
    throw new Error(`Payment request ${paymentRequestId} was just processed by another request`);
  }

  const clinic = await db.getClinicById(req.clinicId);
  if (!clinic) throw new Error(`Clinic ${req.clinicId} not found`);

  const previousTier = getEffectiveTier(clinic);
  const now = Date.now();
  // Only carry forward unused time on a same-tier renewal (e.g. clinic
  // renewing clinic before it expires) — that's paid-for time that
  // shouldn't be lost. A tier CHANGE (upgrade or downgrade) anchors from
  // now instead: the old tier's remaining days are forfeited rather than
  // stacked as free bonus time on the new tier. Without this distinction,
  // upgrading mid-cycle silently added a full new period on top of the
  // unexpired old one (e.g. clinic → pro the day after paying for clinic
  // pushed the renewal date out by 2 full months for the price of 1 pro
  // month + 1 mostly-unused clinic month).
  const isTierChange = req.tier !== previousTier;
  const baseMs =
    !isTierChange && clinic.subscriptionRenewsAt && clinic.subscriptionRenewsAt.getTime() > now
      ? clinic.subscriptionRenewsAt.getTime()
      : now;
  const appliedUntil = new Date(baseMs + req.durationMonths * 30 * 24 * 60 * 60 * 1000);

  await db.updateClinicBillingInfo(req.clinicId, {
    subscriptionTier: req.tier,
    subscriptionStatus: "active",
    subscriptionRenewsAt: appliedUntil,
    gracePeriodEndsAt: null,
    trialEndsAt: null,
  });
  await db.syncBranchTiersToOwner(req.clinicId, {
    subscriptionTier: req.tier,
    subscriptionStatus: "active",
    subscriptionRenewsAt: appliedUntil,
  });

  await db.updatePaymentRequestStatus(paymentRequestId, {
    status: "approved",
    reviewedByUserId,
    reviewedAt: new Date(),
    reviewNote,
    appliedUntil,
    ...(mtnTransactionId ? { mtnTransactionId } : {}),
  });

  await db.logSubscriptionEvent({
    clinicId: req.clinicId,
    eventType: "upgraded",
    fromTier: previousTier,
    toTier: req.tier,
    note: subscriptionEventNote,
    needsReview: false,
  });

  await db.logActivity({
    clinicId: req.clinicId,
    userId: reviewedByUserId,
    action: activityAction,
    entityType: "payment_request",
    entityId: req.id,
    changes: JSON.stringify({
      tier: req.tier,
      durationMonths: req.durationMonths,
      appliedUntil: appliedUntil.toISOString(),
      ...(mtnTransactionId ? { mtnTransactionId } : {}),
    }),
  });

  return { tier: req.tier, appliedUntil, clinicId: req.clinicId };
}
