import { ENV } from "./_core/env";

export type SendEmailResult =
  | { status: "sent" }
  | { status: "failed"; failureReason: string }
  | { status: "skipped"; reason: string };

/**
 * Sends a transactional email via the Resend REST API.
 *
 * No-ops (returns "skipped") if RESEND_API_KEY isn't configured - mirrors
 * sendSMS's behaviour so callers can fire-and-forget without checking
 * configuration first. Never throws.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  if (!ENV.resendApiKey) {
    return { status: "skipped", reason: "Email not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ENV.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ENV.resendFromEmail,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn("[Email] Failed:", response.status, detail);
      return { status: "failed", failureReason: `HTTP ${response.status}${detail ? `: ${detail}` : ""}` };
    }

    return { status: "sent" };
  } catch (error) {
    console.warn("[Email] Error:", error); // Never throw - email never blocks main operation
    return { status: "failed", failureReason: error instanceof Error ? error.message : "Unknown error" };
  }
}

export function escapeHtml(value: string): string {
  const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);
}

export const emailTemplates = {
  welcome: (clinicName: string, recipientName: string) => {
    const safeClinic = escapeHtml(clinicName);
    const safeName = escapeHtml(recipientName);
    return {
      subject: `Welcome to CareDesk, ${safeClinic}!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h1 style="color: #16a34a; font-size: 20px;">Welcome to CareDesk</h1>
          <p>Hi ${safeName},</p>
          <p>Your clinic <strong>${safeClinic}</strong> is now set up on CareDesk on the Free plan — patients, visits, appointments, and billing are ready to go, with no time limit and no card required. The Free plan covers up to 30 new patients and 30 visits a month; upgrade anytime for unlimited usage plus drug inventory and revenue reports.</p>
          <p>Next steps:</p>
          <ul>
            <li>Add your clinic's address and phone number in Settings</li>
            <li>Invite your staff so doctors and receptionists can log in</li>
            <li>Register your first patient</li>
          </ul>
          <p>If you have any questions, just reply to this email.</p>
          <p>— The CareDesk Team</p>
        </div>
      `,
    };
  },

  staffInvite: (clinicName: string, role: string, link: string) => {
    const safeClinic = escapeHtml(clinicName);
    const safeRole = escapeHtml(role);
    const safeLink = escapeHtml(link);
    return {
      subject: `You're invited to join ${safeClinic} on CareDesk`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h1 style="color: #16a34a; font-size: 20px;">You're invited to CareDesk</h1>
          <p><strong>${safeClinic}</strong> has invited you to join their team on CareDesk as a <strong>${safeRole}</strong>.</p>
          <p>Click the link below to set up your account:</p>
          <p><a href="${safeLink}" style="display: inline-block; background: #16a34a; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none;">Accept Invite</a></p>
          <p style="font-size: 12px; color: #6b7280;">This invite link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
        </div>
      `,
    };
  },
};
