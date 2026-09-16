import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseMomoSms } from "./momo-sms";

describe("parseMomoSms", () => {
  describe("MTN — with a phone number in the Reason field", () => {
    // Confirmed against a real SMS (see comment above MTN_RECEIVED_RE).
    const body =
      "You have received UGX 11000 from Airtel Money on 2026-08-21 12:06:14. " +
      "fee:0. Reason: FARIDAH KYALISIIMA , 0743071148. New balance: UGX 11155. ID: 42919920590.";

    it("extracts amount, reason name, reason phone, and transaction id", () => {
      const parsed = parseMomoSms(body, "mtn");
      expect(parsed).toEqual({
        network: "mtn",
        amountUgx: 11000,
        reasonName: "FARIDAH KYALISIIMA",
        reasonPhone: "0743071148",
        transactionId: "42919920590",
      });
    });

    it("strips comma thousand-separators from the amount", () => {
      const withCommas = body.replace("11000", "1,100,000").replace("11155", "1,100,155");
      const parsed = parseMomoSms(withCommas, "mtn");
      expect(parsed?.amountUgx).toBe(1100000);
    });
  });

  describe("MTN — Reason with no phone number", () => {
    const body =
      "You have received UGX 90000 from John Doe on 2026-09-01 09:00:00. " +
      "fee:0. Reason: NAKAWA CLINIC. New balance: UGX 200000. ID: 42999912345.";

    it("falls back to name-only, reasonPhone null", () => {
      const parsed = parseMomoSms(body, "mtn");
      expect(parsed).toEqual({
        network: "mtn",
        amountUgx: 90000,
        reasonName: "NAKAWA CLINIC",
        reasonPhone: null,
        transactionId: "42999912345",
      });
    });
  });

  describe("Airtel — real confirmed P2P wording, NO Reason field", () => {
    // This is the format that broke the original regex: no "Reason:",
    // "Your new balance is" not "New balance:", phone in parentheses,
    // "Transaction ID:" not "txid:".
    const body =
      "You have received UGX 50,000 from JANE SMITH (0757654321) on " +
      "15/12/2024 at 2:30 PM. Your new balance is UGX 320,000. Transaction ID: AIR123456789.";

    it("extracts amount, sender name, sender phone, and transaction id — with no reference field to depend on", () => {
      const parsed = parseMomoSms(body, "airtel");
      expect(parsed).toEqual({
        network: "airtel",
        amountUgx: 50000,
        reasonName: "JANE SMITH",
        reasonPhone: "0757654321",
        transactionId: "AIR123456789",
      });
    });

    it("does NOT match the old placeholder Airtel wording (txid:, comma-separated phone) — confirms the fix replaced it, not just added to it", () => {
      const oldStyleBody =
        "You have received UGX 50000 from JANE SMITH. 0757654321. txid: AIR123456789";
      expect(parseMomoSms(oldStyleBody, "airtel")).toBeNull();
    });
  });

  describe("unrecognised text", () => {
    it("returns null for a non-MoMo SMS", () => {
      expect(parseMomoSms("Your OTP is 483920. Do not share it.", "mtn")).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(parseMomoSms("", "mtn")).toBeNull();
    });
  });
});

// processInboundMomoSms touches the database directly rather than through
// an injected adapter, so these mock server/db.ts's surface rather than
// standing up a real database — enough to exercise the matching branches
// added by the amount-uniqueness fix (see routers.ts requestSubscriptionPayment)
// without needing a live Postgres instance.
vi.mock("./db", () => ({
  createMomoSmsEvent: vi.fn(async (data: any) => ({ id: 1, ...data })),
  isDuplicateOnColumn: vi.fn(() => false),
  getMomoSmsEventByTransactionId: vi.fn(async () => undefined),
  listPendingPaymentRequestsByAmount: vi.fn(async () => []),
  getClinicById: vi.fn(async () => undefined),
  updateMomoSmsEventStatus: vi.fn(async () => undefined),
  getPaymentRequestById: vi.fn(async () => undefined),
  claimPendingPaymentRequest: vi.fn(async () => true),
  updateClinicBillingInfo: vi.fn(async () => undefined),
  syncBranchTiersToOwner: vi.fn(async () => undefined),
  updatePaymentRequestStatus: vi.fn(async () => undefined),
}));
vi.mock("./subscription", () => ({
  getEffectiveTier: vi.fn(() => "free"),
}));

describe("processInboundMomoSms — amount-uniqueness matching", () => {
  const airtelBody =
    "You have received UGX 90047 from JANE SMITH (0757654321) on " +
    "15/12/2024 at 2:30 PM. Your new balance is UGX 320,000. Transaction ID: AIR555.";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches on amount alone when exactly one pending request has that amount — no Reason field needed", async () => {
    const db = await import("./db");
    (db.listPendingPaymentRequestsByAmount as any).mockResolvedValue([
      { id: 7, clinicId: 3, tier: "clinic", durationMonths: 1, requestedByUserId: 9, status: "pending" },
    ]);
    (db.getPaymentRequestById as any).mockResolvedValue({
      id: 7,
      clinicId: 3,
      tier: "clinic",
      durationMonths: 1,
      requestedByUserId: 9,
      status: "pending",
    });
    (db.getClinicById as any).mockResolvedValue({ id: 3, name: "Some Clinic", subscriptionRenewsAt: null });

    const { processInboundMomoSms } = await import("./momo-sms");
    const outcome = await processInboundMomoSms(airtelBody, "airtel");

    expect(outcome.status).toBe("matched");
    if (outcome.status === "matched") {
      expect(outcome.paymentRequestId).toBe(7);
    }
    // The point of the fix: matched WITHOUT ever needing reasonName to
    // resemble the clinic name — Airtel gave none, and it still worked.
  });

  it("falls to no_match when nothing pending shares that amount", async () => {
    const db = await import("./db");
    (db.listPendingPaymentRequestsByAmount as any).mockResolvedValue([]);

    const { processInboundMomoSms } = await import("./momo-sms");
    const outcome = await processInboundMomoSms(airtelBody, "airtel");

    expect(outcome.status).toBe("no_match");
  });

  it("falls back to Reason-text disambiguation only in the rare case of an amount collision", async () => {
    const db = await import("./db");
    (db.listPendingPaymentRequestsByAmount as any).mockResolvedValue([
      { id: 7, clinicId: 3, requestedByUserId: 9, status: "pending" },
      { id: 8, clinicId: 4, requestedByUserId: 10, status: "pending" },
    ]);
    (db.getClinicById as any).mockImplementation(async (id: number) =>
      id === 3 ? { id: 3, name: "Nakawa Clinic" } : { id: 4, name: "Kololo Health Center" }
    );

    const mtnBody =
      "You have received UGX 90047 from John Doe on 2026-09-01 09:00:00. " +
      "fee:0. Reason: NAKAWA CLINIC. New balance: UGX 200000. ID: 42999912345.";

    const { processInboundMomoSms } = await import("./momo-sms");
    const outcome = await processInboundMomoSms(mtnBody, "mtn");

    // Two candidates at the same amount, but only one clinic name is
    // mentioned in the Reason text — should resolve to that one, not
    // bail out to "ambiguous".
    expect(outcome.status).toBe("matched");
  });

  it("stays ambiguous when a rare amount collision can't be disambiguated by name either", async () => {
    const db = await import("./db");
    (db.listPendingPaymentRequestsByAmount as any).mockResolvedValue([
      { id: 7, clinicId: 3, requestedByUserId: 9, status: "pending" },
      { id: 8, clinicId: 4, requestedByUserId: 10, status: "pending" },
    ]);
    (db.getClinicById as any).mockImplementation(async (id: number) =>
      id === 3 ? { id: 3, name: "Nakawa Clinic" } : { id: 4, name: "Entebbe Clinic" }
    );

    const mtnBody =
      "You have received UGX 90047 from John Doe on 2026-09-01 09:00:00. " +
      "fee:0. Reason: SOME OTHER TEXT. New balance: UGX 200000. ID: 42999999999.";

    const { processInboundMomoSms } = await import("./momo-sms");
    const outcome = await processInboundMomoSms(mtnBody, "mtn");

    expect(outcome.status).toBe("ambiguous");
  });

  it("treats a repeated transaction id as a duplicate, not a second match", async () => {
    const db = await import("./db");
    (db.createMomoSmsEvent as any).mockRejectedValue(new Error("unique constraint"));
    (db.isDuplicateOnColumn as any).mockReturnValue(true);
    (db.getMomoSmsEventByTransactionId as any).mockResolvedValue({ id: 42 });

    const { processInboundMomoSms } = await import("./momo-sms");
    const outcome = await processInboundMomoSms(airtelBody, "airtel");

    expect(outcome).toEqual({ status: "duplicate", existingEventId: 42 });
  });

  it("returns parse_failed for text that isn't a recognised MoMo message", async () => {
    const { processInboundMomoSms } = await import("./momo-sms");
    const outcome = await processInboundMomoSms("Your OTP is 123456", "mtn");
    expect(outcome.status).toBe("parse_failed");
  });
});
