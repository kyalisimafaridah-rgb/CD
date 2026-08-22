import { ENV } from './_core/env';

// Dial codes for supported markets. Numbers already in international
// format (starting with '+') are passed through unchanged regardless of
// this default.
const COUNTRY_DIAL_CODES: Record<string, string> = {
  uganda: "256",
  kenya: "254",
  nigeria: "234",
};

export function countryToDialCode(country?: string | null): string {
  if (!country) return COUNTRY_DIAL_CODES.uganda;
  return COUNTRY_DIAL_CODES[country.trim().toLowerCase()] || COUNTRY_DIAL_CODES.uganda;
}

export type SendSmsResult =
  | { status: "sent" }
  | { status: "failed"; failureReason: string }
  | { status: "skipped"; reason: string };

/**
 * Clinic-facing SMS is marked "Coming soon" until production AT credentials
 * are live. Set SMS_FEATURE_ENABLED=true in env to turn sending back on.
 * Backend helpers and logs remain so wiring is ready.
 */
const SMS_FEATURE_ENABLED = process.env.SMS_FEATURE_ENABLED === "true";

export async function sendSMS(phone: string, message: string, countryCode: string = COUNTRY_DIAL_CODES.uganda): Promise<SendSmsResult> {
  if (!SMS_FEATURE_ENABLED) {
    return { status: "skipped", reason: "SMS coming soon" };
  }
  if (!ENV.atApiKey || !ENV.atUsername || ENV.atApiKey === "your_africastalking_api_key") {
    return { status: "skipped", reason: "SMS not configured" };
  }

  let cleaned = phone.replace(/[\s-]+/g, "");

  if (cleaned.startsWith("+")) {
    // Already international format - leave as is.
  } else if (cleaned.startsWith("0")) {
    // Local format (e.g. 0701234567) - drop the leading 0 and prefix the
    // clinic's country dial code.
    cleaned = `+${countryCode}${cleaned.slice(1)}`;
  } else if (cleaned.startsWith(countryCode)) {
    // Country code present but missing the leading '+'.
    cleaned = `+${cleaned}`;
  } else {
    cleaned = `+${countryCode}${cleaned}`;
  }

  // Generic E.164 sanity check: '+' followed by 10-15 digits.
  if (!/^\+\d{10,15}$/.test(cleaned)) {
    console.warn("[SMS] Invalid phone number:", phone);
    return { status: "skipped", reason: "Invalid phone number" };
  }

  try {
    const baseUrl = ENV.atUsername === "sandbox"
      ? "https://api.sandbox.africastalking.com/version1/messaging"
      : "https://api.africastalking.com/version1/messaging";

    const body = new URLSearchParams({
      username: ENV.atUsername,
      to: cleaned,
      message,
      from: "CareDesk",
    });

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "apiKey": ENV.atApiKey,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn("[SMS] Failed:", response.status);
      return { status: "failed", failureReason: `HTTP ${response.status}${detail ? `: ${detail}` : ""}` };
    }

    console.log("[SMS] Sent to", cleaned);
    return { status: "sent" };
  } catch (error) {
    console.warn("[SMS] Error:", error); // Never throw — SMS never blocks main operation
    return { status: "failed", failureReason: error instanceof Error ? error.message : "Unknown error" };
  }
}

export const smsTemplates = {
  appointmentReminder: (patientName: string, date: string, clinicName: string) =>
    `Dear ${patientName}, reminder: you have an appointment at ${clinicName} on ${date}. Please arrive 10 minutes early. Reply STOP to opt out.`,

  paymentReminder: (patientName: string, amount: number, clinicName: string) =>
    `Dear ${patientName}, you have an outstanding balance of UGX ${amount.toLocaleString()} at ${clinicName}. Please pay at your earliest convenience.`,

  paymentReceived: (patientName: string, amount: number, balance: number) =>
    `Dear ${patientName}, payment of UGX ${amount.toLocaleString()} received. ${balance > 0 ? `Remaining balance: UGX ${balance.toLocaleString()}.` : "Your account is fully paid."} Thank you.`,

  staffInvite: (clinicName: string, role: string, link: string) =>
    `You've been invited to join ${clinicName} on CareDesk as a ${role}. Accept your invite here: ${link}`,
};

export type SmsBalance = { balance: string };

/**
 * Fetches the Africa's Talking account balance (e.g. "KES 482.50") for
 * display in Settings. Returns null if SMS isn't configured or the
 * request fails - never throws.
 */
export async function getSmsBalance(): Promise<SmsBalance | null> {
  if (!ENV.atApiKey || !ENV.atUsername || ENV.atApiKey === "your_africastalking_api_key") {
    return null;
  }

  try {
    const baseUrl = ENV.atUsername === "sandbox"
      ? "https://api.sandbox.africastalking.com/version1/user"
      : "https://api.africastalking.com/version1/user";

    const response = await fetch(`${baseUrl}?username=${encodeURIComponent(ENV.atUsername)}`, {
      headers: { "Accept": "application/json", "apiKey": ENV.atApiKey },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { UserData?: { balance?: string } };
    const balance = data.UserData?.balance;
    return typeof balance === "string" ? { balance } : null;
  } catch (error) {
    console.warn("[SMS] Failed to fetch balance:", error);
    return null;
  }
}
