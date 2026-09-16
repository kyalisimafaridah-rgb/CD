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
 * Airtel Money's confirmed real Uganda P2P "received" wording — structurally
 * different from MTN's, not just reworded:
 * "You have received UGX 50,000 from JANE SMITH (0757654321) on
 *  15/12/2024 at 2:30 PM. Your new balance is UGX 320,000.
 *  Transaction ID: AIR123456789."
 *
 * Critically, there is NO "Reason:" field at all in this template — Airtel
 * P2P gives no free-text slot for a payer to type a clinic name into. That
 * is why matching here CANNOT depend on reasonName the way MTN's path can;
 * see processInboundMomoSms below, which now matches on the unique
 * per-request amountUgx first and treats name/phone as corroboration only.
 * The payer's own phone number IS present here (in parentheses) even
 * though no reference text is — captured as reasonPhone for that reason.
 */
const AIRTEL_RECEIVED_RE =
  /you have received ugx\s*([\d,]+)\s*from\s+(.+?)\s*\((\d{6,15})\)\s*on\b.+?transaction id:\s*(\w+)/is;

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

  // amountUgx is now unique per request (see requestSubscriptionPayment in
  // routers.ts — base tier price + an offset derived from the request's own
  // id), so an exact amount match should almost always identify exactly one
  // request on its own. This is now the PRIMARY signal, not the Reason-text
  // match below — that distinction matters specifically for Airtel P2P,
  // whose confirmed SMS wording has no Reason field at all to match against.
  const candidates = await db.listPendingPaymentRequestsByAmount(parsed.amountUgx);

  if (candidates.length === 0) {
    await db.updateMomoSmsEventStatus(eventId, { status: "no_match" });
    return { status: "no_match" };
  }

  let req = candidates[0];
  let reviewNote = `Auto-approved via MoMo SMS, exact amount match (txn ${parsed.transactionId})`;

  if (candidates.length > 1) {
    // Should be rare now that amounts are per-request-unique — most likely
    // cause is an older pre-uniqueness request still pending, or a manual
    // amountUgx edit. Name-matching is the tiebreaker here, same as before,
    // but it's now a fallback for this edge case rather than the main path.
    const withClinics = await Promise.all(
      candidates.map(async (r) => ({ r, clinic: await db.getClinicById(r.clinicId) }))
    );
    const matching = withClinics.filter(
      ({ clinic }) => clinic && reasonMentionsClinicName(parsed.reasonName, clinic.name)
    );
    if (matching.length !== 1) {
      await db.updateMomoSmsEventStatus(eventId, {
        status: "ambiguous",
        note: `${candidates.length} pending request(s) at this amount; Reason text "${parsed.reasonName}" narrowed to ${matching.length} candidate(s), not exactly 1.`,
      });
      return { status: "ambiguous", candidateIds: candidates.map((c) => c.id) };
    }
    req = matching[0].r;
    reviewNote = `Auto-approved via MoMo SMS, disambiguated by Reason text (txn ${parsed.transactionId})`;
  }

  const result = await applyPaymentApproval({
    paymentRequestId: req.id,
    reviewedByUserId: req.requestedByUserId, // no admin actor for an auto-approval
    reviewNote,
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
