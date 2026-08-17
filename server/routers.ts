import { COOKIE_NAME } from "@shared/const";
import { isDrugExpired } from "@shared/inventory";
import { validatePaymentAmount } from "@shared/billing";
import { namesMatch, normalizePhone, phonesMatch } from "@shared/patients";
import { randomUUID, randomBytes, randomInt } from "crypto";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { hashPassword, verifyPassword, setSessionCookie, MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MS } from "./auth";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure, ownerProcedure, rateLimited } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";
import { sendSMS, smsTemplates, countryToDialCode, getSmsBalance } from "./sms";
import type { TrpcContext } from "./_core/context";
import { sendEmail, emailTemplates, escapeHtml } from "./email";
import { getClinicAccessStatus, normaliseTier, getClinicTierLimits, getEffectiveTier, isPaidPeriodActive } from "./subscription";
import { TIER_LIMITS, hasUnlimitedStaff, hasUnlimitedBranches } from "../shared/tiers";
import type { smsNotifications } from "../drizzle/schema";
import { runFullBackup } from "./backup";

// ─── Password-reset rate limiter ─────────────────────────────────────────────
// Prevents Resend quota abuse and spam-sender flagging.
// Stores the last-sent timestamp per email address in memory.
// One Railway instance is fine at early stage; swap for Redis if you ever
// run multiple replicas.
const passwordResetCooldowns = new Map<string, number>();
const PASSWORD_RESET_COOLDOWN_MS = 60_000; // 1 minute between requests per email

function isPasswordResetRateLimited(email: string): boolean {
  const lastSent = passwordResetCooldowns.get(email);
  if (lastSent && Date.now() - lastSent < PASSWORD_RESET_COOLDOWN_MS) return true;
  passwordResetCooldowns.set(email, Date.now());
  // Prune entries older than 10 minutes to prevent unbounded memory growth
  if (passwordResetCooldowns.size > 10_000) {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, v] of passwordResetCooldowns) {
      if (v < cutoff) passwordResetCooldowns.delete(k);
    }
  }
  return false;
}

// Same pattern as the password-reset cooldown above, applied to phone OTP.
// Without this, requestOtp had no cooldown at all: every call that finds a
// matching active user sends a real SMS via Africa's Talking immediately.
// Anyone could spam this endpoint to SMS-bomb a phone number or run up the
// clinic's SMS bill — there is no client-side throttle to rely on.
const otpRequestCooldowns = new Map<string, number>();
const OTP_REQUEST_COOLDOWN_MS = 60_000; // 1 minute between OTP requests per phone

function isOtpRequestRateLimited(phone: string): boolean {
  const lastSent = otpRequestCooldowns.get(phone);
  if (lastSent && Date.now() - lastSent < OTP_REQUEST_COOLDOWN_MS) return true;
  otpRequestCooldowns.set(phone, Date.now());
  if (otpRequestCooldowns.size > 10_000) {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, v] of otpRequestCooldowns) {
      if (v < cutoff) otpRequestCooldowns.delete(k);
    }
  }
  return false;
}

/**
 * Sends an SMS to a patient and logs the outcome to smsNotifications.
 * Skips silently (no send, no log) if the patient has opted out or has no
 * phone number on file. "skipped" outcomes from sendSMS itself (SMS not
 * configured, invalid number) are also not logged, since no real attempt
 * reached the SMS provider.
 */
async function sendAndLogSms(params: {
  clinicId: number;
  patient: { phone: string | null; smsOptOut: boolean };
  message: string;
  countryCode: string;
  messageType: (typeof smsNotifications.$inferInsert)["messageType"];
  appointmentId?: number;
  billId?: number;
}): Promise<void> {
  const { clinicId, patient, message, countryCode, messageType, appointmentId, billId } = params;
  if (!patient.phone || patient.smsOptOut) return;

  const result = await sendSMS(patient.phone, message, countryCode);
  if (result.status === "skipped") return;

  await db.createSmsNotification({
    clinicId,
    recipientPhone: patient.phone,
    recipientType: "patient",
    messageType,
    messageContent: message,
    appointmentId,
    billId,
    status: result.status,
    sentDate: result.status === "sent" ? new Date() : undefined,
    failureReason: result.status === "failed" ? result.failureReason : undefined,
  });
}

/**
 * Builds an absolute URL to an invite-acceptance link. Prefers APP_URL
 * (recommended for production, especially behind a proxy that may not set
 * forwarded-proto headers), falling back to the request's own origin so
 * this works out of the box in local dev with no extra config.
 */
function buildInviteLink(req: TrpcContext["req"], token: string): string {
  const origin = ENV.appUrl || `${req.protocol}://${req.get("host")}`;
  return `${origin.replace(/\/+$/, "")}/accept-invite/${token}`;
}

// Validation schemas
const patientSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  age: z.number().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  village: z.string().optional(),
  nextOfKin: z.string().optional(),
  nextOfKinPhone: z.string().optional(),
  medicalHistory: z.string().optional(),
  allergies: z.string().optional(),
  forceCreate: z.boolean().optional(), // bypass duplicate warning
  clientMutationId: z.string().uuid().optional(), // offline-sync idempotency key
});

const visitSchema = z.object({
  patientId: z.number(),
  visitDate: z.string(),
  chiefComplaint: z.string().optional(),
  clinicalNotes: z.string().optional(),
  prescriptionNotes: z.string().optional(),
  diagnosis: z.string().optional(),
  consultationFee: z.number().min(0, "Consultation fee cannot be negative"),
  labTests: z.array(z.object({
    testName: z.string().min(1, "Test name is required"),
    cost: z.number().min(0, "Lab test cost cannot be negative"),
  })).optional(),
  prescribedDrugs: z.array(z.object({
    drugId: z.number().optional(),
    drugName: z.string().min(1, "Drug name is required"),
    dosage: z.string().optional(),
    quantity: z.number().min(1, "Quantity must be at least 1"),
    unit: z.string().optional(),
    costPerUnit: z.number().min(0, "Cost per unit cannot be negative"),
    instructions: z.string().optional(),
  })).optional(),
  clientMutationId: z.string().uuid().optional(), // offline-sync idempotency key
});

const drugSchema = z.object({
  drugName: z.string().min(1, "Drug name is required"),
  genericName: z.string().optional(),
  quantity: z.number().min(0),
  unit: z.string(),
  costPerUnit: z.number().min(0),
  sellingPrice: z.number().min(0),
  lowStockThreshold: z.number().min(0),
  expiryDate: z.string().optional(),
  batchNumber: z.string().optional(),
  supplier: z.string().optional(),
});

const appointmentSchema = z.object({
  patientId: z.number(),
  appointmentDate: z.string(),
  duration: z.number().min(1, "Duration must be at least 1 minute").default(30),
  reason: z.string().optional(),
  notes: z.string().optional(),
  assignedDoctor: z.number().optional(),
  forceCreate: z.boolean().optional(), // bypass double-booking warning
  clientMutationId: z.string().uuid().optional(), // offline-sync idempotency key
});

const staffInviteSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(["receptionist", "doctor", "manager"]),
}).refine((data) => !!data.email || !!data.phone, {
  message: "Provide an email or phone number for the invite",
  path: ["email"],
});

export const appRouter = router({
  system: systemRouter,
  
  auth: router({
    me: publicProcedure.query((opts) => {
      if (!opts.ctx.user) return null;
      const isPlatformOwner = !!ENV.ownerEmail && opts.ctx.user.email?.toLowerCase() === ENV.ownerEmail.toLowerCase();
      return { ...opts.ctx.user, isPlatformOwner };
    }),

    changePassword: protectedProcedure
      .input(z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "Password must be at least 8 characters"),
      }))
      .mutation(async ({ ctx, input }) => {
        const user = await db.getUserById(ctx.user.id);
        if (!user) throw new TRPCError({ code: "NOT_FOUND" });
        const valid = await verifyPassword(input.currentPassword, user.passwordHash);
        if (!valid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Current password is incorrect" });
        }
        const newHash = await hashPassword(input.newPassword);
        await db.updateUserPassword(ctx.user.id, newHash);
        // Reissues a fresh cookie for this session while bumping
        // sessionVersion — signs everyone else out, keeps this session in.
        await setSessionCookie(ctx.req, ctx.res, ctx.user.id, true);
        return { success: true } as const;
      }),

    register: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(8, "Password must be at least 8 characters"),
        name: z.string().min(1).max(255),
        clinicName: z.string().min(1).max(255),
        phone: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await db.getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists" });
        }

        const passwordHash = await hashPassword(input.password);
        const isFirstUser = !(await db.hasAnyUsers());

        // The very first account on the platform is the SaaS owner/admin.
        // "admin" already has manager-equivalent permissions everywhere
        // else in this router, so they can also use their own clinic.
        const role: "admin" | "manager" = isFirstUser ? "admin" : "manager";

        // Create clinic, then user, then backfill ownerId sequentially.
        // A transaction wrapper is omitted here because the sub-functions call
        // getDb() internally and would acquire different pool connections —
        // making the transaction illusory. A failure between steps is rare
        // (the clinic or user insert itself rarely fails) and recoverable via
        // retry. Orphaned clinic rows are cleaned up by the admin dashboard.
        const clinicId = await db.createClinicAndReturnId({
          name: input.clinicName,
          country: "Uganda",
          subscriptionStatus: "active",
          subscriptionTier: "free",
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          // ownerId backfilled below once we have the userId
        });

        const userId = await db.createUserAndReturnId({
          openId: randomUUID(),
          email: input.email,
          name: input.name,
          phone: input.phone,
          passwordHash,
          loginMethod: "password",
          role,
          clinicId,
          lastSignedIn: new Date(),
        });

        // Backfill ownerId now that userId is known.
        await db.setClinicOwner(clinicId, userId);

        await setSessionCookie(ctx.req, ctx.res, userId);

        const welcome = emailTemplates.welcome(input.clinicName, input.name);
        void sendEmail({ to: input.email, subject: welcome.subject, html: welcome.html });

        return { success: true } as const;
      }),

    login: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(1),
        rememberMe: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        const user = await db.getUserByEmail(input.email);

        if (!user || !user.passwordHash) {
          // Run a dummy verify so the response time is the same whether or
          // not the account exists (prevents user-enumeration via timing).
          await verifyPassword(input.password, "dummy:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
        }

        if (!user.isActive) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This account has been deactivated" });
        }

        // Check lockout before verifying password to avoid unnecessary work.
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Too many failed login attempts. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.`,
          });
        }

        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) {
          const { attempts } = await db.incrementFailedLoginAttempts(user.id);
          if (attempts >= MAX_FAILED_ATTEMPTS) {
            const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
            await db.lockUserUntil(user.id, lockUntil);
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `Too many failed attempts. Account locked for 15 minutes.`,
            });
          }
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
        }

        // Successful login — clear lockout state and issue a new session.
        await db.clearFailedLoginAttempts(user.id);
        await db.touchLastSignedIn(user.id);
        await setSessionCookie(ctx.req, ctx.res, user.id, input.rememberMe);

        // Return role so the client can redirect to the right page.
        return { success: true, role: user.role } as const;
      }),

    logout: publicProcedure.mutation(async ({ ctx }) => {
      // Bump sessionVersion so the old JWT is immediately invalid server-side.
      // Without this, a stolen cookie remains usable until its natural expiry.
      if (ctx.user) {
        await db.bumpSessionVersion(ctx.user.id).catch(() => {});
      }
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

    // ----- Phone + OTP login (Africa's Talking) -----

    requestOtp: publicProcedure
      .input(z.object({ phone: z.string().min(7) }))
      .mutation(async ({ input }) => {
        // Always return success — don't reveal whether the phone number exists,
        // and don't reveal rate limiting either (both paths return the same shape).
        if (isOtpRequestRateLimited(input.phone)) {
          return { success: true } as const;
        }
        const user = await db.getUserByPhone(input.phone);

        if (user && user.isActive) {
          // crypto.randomInt, not Math.random() — this is a login credential,
          // same bar as the password-reset/invite tokens below, which already
          // use the crypto module. randomInt(100000, 1000000) is upper-exclusive,
          // giving the same 100000-999999 range as the old Math.random() formula.
          const otp = randomInt(100000, 1000000).toString();
          // hashPassword is already statically imported — no need for a dynamic import
          const codeHash = await hashPassword(otp);
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

          await db.createOtpCode(input.phone, codeHash, expiresAt);

          // clinic for country code — best-effort, OTP sends regardless
          const clinic = user.clinicId ? await db.getClinicById(user.clinicId) : null;
          const message = `Your CareDesk login code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
          void sendSMS(input.phone, message, countryToDialCode(clinic?.country));
        }

        return { success: true } as const;
      }),

    verifyOtp: publicProcedure
      .input(z.object({
        phone: z.string().min(7),
        code: z.string().length(6),
        rememberMe: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        const OTP_MAX_ATTEMPTS = 5;
        const otpRecord = await db.getLatestOtpForPhone(input.phone);

        if (!otpRecord) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired code" });
        }

        const attempts = await db.incrementOtpAttempts(otpRecord.id);
        if (attempts > OTP_MAX_ATTEMPTS) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Too many attempts. Request a new code." });
        }

        const valid = await verifyPassword(input.code, otpRecord.codeHash);
        if (!valid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired code" });
        }

        await db.markOtpUsed(otpRecord.id);

        const user = await db.getUserByPhone(input.phone);
        if (!user || !user.isActive) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Account not found" });
        }

        await db.clearFailedLoginAttempts(user.id);
        await db.touchLastSignedIn(user.id);
        await setSessionCookie(ctx.req, ctx.res, user.id, input.rememberMe);

        return { success: true, role: user.role } as const;
      }),

    // ----- Password reset -----

    requestPasswordReset: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ ctx, input }) => {
        // Always return success — don't reveal whether the email exists.
        // Rate-limit silently: still return success so the address isn't enumerable.
        if (isPasswordResetRateLimited(input.email.toLowerCase())) {
          return { success: true } as const;
        }
        const user = await db.getUserByEmail(input.email);

        if (user) {
          const token = randomBytes(32).toString("hex");
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
          await db.setPasswordResetToken(user.id, token, expiresAt);

          // Use APP_URL if set; fall back to the request's own origin so
          // this works in local dev even without APP_URL configured.
          const origin = ENV.appUrl || `${ctx.req.protocol}://${ctx.req.get("host")}`;
          const resetLink = `${origin.replace(/\/+$/, "")}/reset-password/${token}`;
          const html = `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #16a34a;">Reset your CareDesk password</h2>
              <p>Click the link below to reset your password. This link expires in 1 hour.</p>
              <p><a href="${resetLink}" style="background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset Password</a></p>
              <p style="font-size:12px;color:#6b7280;">If you didn't request this, ignore this email.</p>
            </div>
          `;
          void sendEmail({ to: input.email, subject: "Reset your CareDesk password", html });
        }

        return { success: true } as const;
      }),

    resetPassword: publicProcedure
      .input(z.object({
        token: z.string(),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }))
      .mutation(async ({ ctx, input }) => {
        const user = await db.getUserByPasswordResetToken(input.token);
        if (!user) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This reset link is invalid or has expired" });
        }

        const passwordHash = await hashPassword(input.password);
        await db.applyPasswordReset(user.id, passwordHash);
        await setSessionCookie(ctx.req, ctx.res, user.id, true);

        return { success: true, role: user.role } as const;
      }),
  }),

  // Clinic operations
  clinic: router({
    getOrCreate: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.user.clinicId) {
        const newClinicId = await db.createClinicAndReturnId({
          name: `${ctx.user.name}'s Clinic`,
          country: "Uganda",
          subscriptionStatus: "active",
          subscriptionTier: "free",
          ownerId: ctx.user.id,
        });
        // Link the user to the newly created clinic
        await db.updateUserClinic(ctx.user.id, newClinicId);
        // Re-issue session so clinicId is in the new JWT immediately
        await setSessionCookie(ctx.req, ctx.res, ctx.user.id, true);
        return await db.getClinicById(newClinicId);
      }
      return await db.getClinicById(ctx.user.clinicId);
    }),
    
    get: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) return null;
      const justExpired = await db.enforceExpiredPaidPeriod(ctx.user.clinicId);
      const clinic = (await db.getClinicById(ctx.user.clinicId)) ?? ctx.clinic;
      if (!clinic) return null;
      const access = getClinicAccessStatus(clinic);
      return {
        ...clinic,
        effectiveTier: access.allowed ? access.tier : getEffectiveTier(clinic),
        accessWarning: justExpired
          ? "subscription_expired"
          : access.allowed
            ? access.warning ?? null
            : null,
        subscriptionRenewsAt: clinic.subscriptionRenewsAt,
      };
    }),

    update: protectedProcedure.input(z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      // Keep in sync with COUNTRY_DIAL_CODES in server/sms.ts — an
      // unsupported value here would silently fall back to Uganda's dial
      // code on every SMS, which is exactly the bug this field fixes.
      country: z.enum(["Uganda", "Kenya", "Nigeria"]).optional(),
      consultationFee: z.number().optional(),
      mtnMomoNumber: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can update clinic settings" });
      }
      const { consultationFee, ...rest } = input;
      await db.updateClinic(ctx.user.clinicId, {
        ...rest,
        consultationFee: consultationFee !== undefined ? String(consultationFee) : undefined,
      });
      return { success: true };
    }),

    getSmsBalance: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return await getSmsBalance();
    }),

    // Surfaces whether SMS/email are running against sandbox/test
    // credentials — both silently fail to reach real phone numbers/inboxes
    // in that mode. Provisioning real Africa's Talking + Resend production
    // credentials is a Shafic action (see Settings for the warning banner
    // this powers), not something fixable in code.
    getIntegrationStatus: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return {
        smsSandbox: ENV.atUsername === "sandbox" || !ENV.atUsername,
        emailSandbox: ENV.resendFromEmail.includes("resend.dev"),
      };
    }),

    getServiceTemplates: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      return await db.getServiceTemplatesByClinic(ctx.user.clinicId);
    }),

    addServiceTemplate: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        category: z.enum(["consultation", "lab", "drug", "other"]),
        price: z.number().min(0),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can add service templates" });
        }
        await db.createServiceTemplate({
          clinicId: ctx.user.clinicId,
          name: input.name,
          category: input.category,
          price: String(input.price) as any,
        });
        return { success: true } as const;
      }),

    deleteServiceTemplate: protectedProcedure
      .input(z.object({ templateId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await db.deleteServiceTemplate(input.templateId, ctx.user.clinicId);
        return { success: true } as const;
      }),

    getMyBranches: protectedProcedure.query(async ({ ctx }) => {
      // Returns all clinics owned by this user (via ownerId).
      // Used by the branch switcher — only relevant for owners who have
      // registered more than one clinic.
      return await db.getClinicsByOwner(ctx.user.id);
    }),

    addBranch: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can add clinic branches" });
        }

        const currentClinic = ctx.clinic;

        // Only the clinic's actual owner may add a branch — not just any staff
        // member who happens to have role="manager". An invited manager (added
        // via staff.invite to someone else's clinic) has manager permissions
        // there but is NOT clinic.ownerId. Without this check, an invited
        // manager could create a brand-new clinic under their own ownership
        // that inherits the parent clinic's paid tier for free.
        if (ctx.user.role === "manager" && currentClinic?.ownerId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the clinic owner can add branches" });
        }

        // ── Tier enforcement: branch limit ───────────────────────────────
        const tier = getEffectiveTier(currentClinic as any);
        if (!hasUnlimitedBranches(tier)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `TIER_LIMIT_BRANCHES:1:${tier}`,
          });
        }

        // Inherit the parent clinic's tier so Pro users don't get branches locked after 14 days.
        // Branches are owned by the same owner, so they share the plan tier.
        const newClinicId = await db.createClinicAndReturnId({
          name: input.name,
          country: currentClinic?.country ?? "Uganda",
          subscriptionStatus: "active",
          subscriptionTier: tier, // inherit — not always "free"
          ownerId: ctx.user.id,
          // trialEndsAt only needed if free — paid tiers don't use it
          trialEndsAt: tier === "free" ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : undefined,
        });
        return { success: true, clinicId: newClinicId } as const;
      }),

    switchBranch: protectedProcedure
      .input(z.object({ clinicId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // Verify the user owns the target clinic before switching.
        const branches = await db.getClinicsByOwner(ctx.user.id);
        const target = branches.find((b) => b.id === input.clinicId);
        if (!target) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this clinic branch" });
        }
        await db.updateUserClinic(ctx.user.id, input.clinicId);
        // setSessionCookie calls bumpSessionVersion internally — do NOT call it separately here
        // or the version will be bumped twice and the issued JWT will be immediately invalid.
        await setSessionCookie(ctx.req, ctx.res, ctx.user.id, true);
        return { success: true, clinicName: target.name } as const;
      }),

    getTierStatus: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      // Persist auto-downgrade when prepaid period ended
      if (ctx.clinic) {
        await db.enforceExpiredPaidPeriod(ctx.user.clinicId);
      }
      const clinic = (await db.getClinicById(ctx.user.clinicId)) ?? ctx.clinic;
      if (!clinic) throw new TRPCError({ code: "NOT_FOUND" });
      const access = getClinicAccessStatus(clinic);
      const tier = access.allowed ? access.tier : getEffectiveTier(clinic);
      const limits = getClinicTierLimits(tier);
      const [patientsThisMonth, visitsThisMonth, activeStaff] = await Promise.all([
        db.countPatientsThisMonth(ctx.user.clinicId),
        db.countVisitsThisMonth(ctx.user.clinicId),
        db.countActiveStaff(ctx.user.clinicId),
      ]);
      return {
        tier,
        storedTier: normaliseTier(clinic.subscriptionTier),
        limits,
        usage: {
          patientsThisMonth,
          visitsThisMonth,
          activeStaff,
        },
        subscriptionRenewsAt: clinic.subscriptionRenewsAt ?? null,
        lsSubscriptionId: clinic.lsSubscriptionId ?? null,
        warning: access.allowed ? access.warning ?? null : null,
        paidPeriodActive: isPaidPeriodActive(clinic),
      };
    }),


    /**
     * Redeem an MTN MoMo activation code generated by the platform admin.
     * Applies the paid tier for `durationMonths` from now (or extends if
     * the clinic is already on a paid plan that has not expired).
     */
    
    /**
     * Self-service: clinic claims they paid (or will pay) via MTN MoMo.
     * Creates a pending request for admin one-click approval — no waiting
     * for a manually typed activation code.
     */
    requestSubscriptionPayment: protectedProcedure
      .input(z.object({
        tier: z.enum(["clinic", "pro"]),
        durationMonths: z.number().int().min(1).max(36),
        mtnTransactionId: z.string().max(64).optional(),
        note: z.string().max(500).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can request a plan upgrade" });
        }

        const monthly = input.tier === "pro" ? TIER_LIMITS.pro.priceUgx : TIER_LIMITS.clinic.priceUgx;
        const amountUgx = monthly * input.durationMonths;

        // Block spam: only one pending request per clinic
        const existing = await db.listPaymentRequestsForClinic(ctx.user.clinicId, 5);
        if (existing.some((r) => r.status === "pending")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You already have a pending payment request. Wait for approval or cancel it first.",
          });
        }

        const clinic = await db.getClinicById(ctx.user.clinicId);
        if (!clinic) throw new TRPCError({ code: "NOT_FOUND", message: "Clinic not found" });
        // Always store the registered clinic name as MoMo reason so admin matching
        // is unambiguous and clinics cannot claim another clinic's name.
        const momoReason = clinic.name.trim();

        const row = await db.createPaymentRequest({
          clinicId: ctx.user.clinicId,
          requestedByUserId: ctx.user.id,
          tier: input.tier,
          durationMonths: input.durationMonths,
          amountUgx,
          payerPhone: momoReason,
          mtnTransactionId: input.mtnTransactionId?.trim() || null,
          note: input.note?.trim() || null,
          status: "pending",
        });

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "REQUEST_SUBSCRIPTION_PAYMENT",
          entityType: "payment_request",
          entityId: row.id,
          changes: JSON.stringify({ tier: input.tier, durationMonths: input.durationMonths, amountUgx, momoReason }),
        });

        return {
          id: row.id,
          amountUgx,
          tier: input.tier,
          durationMonths: input.durationMonths,
          message: "Request submitted. Your plan will activate once payment is confirmed (usually quickly during business hours).",
        } as const;
      }),

    listMyPaymentRequests: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      return await db.listPaymentRequestsForClinic(ctx.user.clinicId, 20);
    }),

    cancelMyPaymentRequest: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const req = await db.getPaymentRequestById(input.id);
        if (!req || req.clinicId !== ctx.user.clinicId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (req.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only pending requests can be cancelled" });
        }
        await db.updatePaymentRequestStatus(input.id, { status: "cancelled", reviewedAt: new Date() });
        return { success: true } as const;
      }),

redeemActivationCode: protectedProcedure
      .input(z.object({
        code: z.string().min(8).max(40),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can activate a subscription" });
        }

        const record = await db.getActivationCodeByCode(input.code);
        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invalid activation code" });
        }
        if (record.revokedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This code has been revoked" });
        }
        if (record.redeemedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This code was already used" });
        }
        if (record.codeExpiresAt && record.codeExpiresAt.getTime() < Date.now()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This code has expired — ask the admin for a new one" });
        }

        const clinic = await db.getClinicById(ctx.user.clinicId);
        if (!clinic) throw new TRPCError({ code: "NOT_FOUND" });

        const previousTier = getEffectiveTier(clinic);
        const now = Date.now();
        // If already paid and renews in the future, extend from that date; else from now
        const baseMs =
          clinic.subscriptionRenewsAt && clinic.subscriptionRenewsAt.getTime() > now
            ? clinic.subscriptionRenewsAt.getTime()
            : now;
        const appliedUntil = new Date(baseMs + record.durationMonths * 30 * 24 * 60 * 60 * 1000);

        const marked = await db.markActivationCodeRedeemed({
          id: record.id,
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          appliedUntil,
        });
        // rowCount 0 means another request raced us
        const rows = Number((marked as any)?.rowCount ?? (marked as any)?.count ?? 1);
        if (rows === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "This code was just used by someone else" });
        }

        await db.updateClinicBillingInfo(ctx.user.clinicId, {
          subscriptionTier: record.tier,
          subscriptionStatus: "active",
          subscriptionRenewsAt: appliedUntil,
          gracePeriodEndsAt: null,
          trialEndsAt: null,
        });
        await db.syncBranchTiersToOwner(ctx.user.clinicId, {
          subscriptionTier: record.tier,
          subscriptionStatus: "active",
          subscriptionRenewsAt: appliedUntil,
        });

        await db.logSubscriptionEvent({
          clinicId: ctx.user.clinicId,
          eventType: previousTier === "free" || previousTier !== record.tier ? "upgraded" : "upgraded",
          fromTier: previousTier,
          toTier: record.tier,
          note: `Activation code ${record.code} — ${record.durationMonths} month(s) via MTN MoMo`,
          needsReview: false,
        });

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "REDEEM_ACTIVATION_CODE",
          entityType: "activation_code",
          entityId: record.id,
          changes: JSON.stringify({
            code: record.code,
            tier: record.tier,
            durationMonths: record.durationMonths,
            appliedUntil: appliedUntil.toISOString(),
          }),
        });

        return {
          success: true as const,
          tier: record.tier,
          durationMonths: record.durationMonths,
          appliedUntil,
        };
      }),

    getCheckoutUrl: protectedProcedure
      .input(z.object({ plan: z.enum(["clinic", "pro"]) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (!ENV.lemonStoreSlug) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Billing not configured" });
        }
        const variantId = input.plan === "pro" ? ENV.lemonVariantPro : ENV.lemonVariantClinic;
        if (!variantId) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Plan variant not configured" });
        }
        // After payment, Lemonsqueezy redirects back to /settings?upgraded=1
        // The client detects this param, invalidates the tier cache, and redirects to dashboard.
        const origin = ENV.appUrl || `${ctx.req.protocol}://${ctx.req.get("host")}`;
        const successUrl = `${origin.replace(/\/+$/, "")}/settings?upgraded=1`;

        const params = new URLSearchParams({
          "checkout[custom][clinic_id]": String(ctx.user.clinicId),
          "checkout[email]": ctx.user.email ?? "",
          "checkout[redirect_url]": successUrl,
        });
        const url = `https://${ENV.lemonStoreSlug}.lemonsqueezy.com/checkout/buy/${variantId}?${params.toString()}`;
        return { url };
      }),

    // Self-serve downgrade/cancel — previously the only way off a paid plan
    // was to email support. LemonSqueezy's hosted customer portal lets the
    // clinic owner change plans or cancel themselves.
    getBillingPortalUrl: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can manage billing" });
      }
      const clinic = ctx.clinic;
      if (!clinic?.lsSubscriptionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This clinic has no active paid subscription to manage." });
      }
      if (!ENV.lemonSqueezyApiKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Self-serve billing portal isn't configured yet — email support to change or cancel your plan.",
        });
      }
      const res = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${clinic.lsSubscriptionId}`, {
        headers: { Accept: "application/vnd.api+json", Authorization: `Bearer ${ENV.lemonSqueezyApiKey}` },
      });
      if (!res.ok) {
        console.error(`[Lemonsqueezy] Failed to fetch subscription ${clinic.lsSubscriptionId}: ${res.status}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't reach the billing portal. Try again shortly." });
      }
      const body = await res.json();
      const portalUrl = body?.data?.attributes?.urls?.customer_portal;
      if (!portalUrl) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Billing portal URL unavailable." });
      }
      return { url: portalUrl as string };
    }),

    getSmsLog: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const clinic = ctx.clinic;
      const tier = getEffectiveTier(clinic as any);
      if (!getClinicTierLimits(tier).smsLogs) {
        throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:smsLogs:clinic" });
      }
      return await db.getSmsNotificationsByClinic(ctx.user.clinicId, 100);
    }),

    getActivityLog: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const clinic = ctx.clinic;
      const tier = getEffectiveTier(clinic as any);
      if (!getClinicTierLimits(tier).activityLog) {
        throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:activityLog:clinic" });
      }
      return await db.getActivityLogsByClinic(ctx.user.clinicId, 200);
    }),
  }),

  // Patient operations
  patient: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      return await db.getPatientsByClinic(ctx.user.clinicId);
    }),

    listInactive: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can view deactivated patients" });
      }
      return await db.getInactivePatients(ctx.user.clinicId);
    }),

    restore: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can restore patients" });
        }
        const patient = await db.getPatientById(input.id);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        await db.restorePatient(input.id);
        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "RESTORE_PATIENT",
          entityType: "patient",
          entityId: input.id,
        });
        return { success: true } as const;
      }),

    search: protectedProcedure
      .use(rateLimited(60, 60_000))
      .input(z.object({ query: z.string() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return await db.searchPatients(ctx.user.clinicId, input.query);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const patient = await db.getPatientById(input.id);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return patient;
      }),

    create: protectedProcedure
      .input(patientSchema)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });

        // ── Offline-sync idempotency ───────────────────────────────────────
        // If this exact submission (same clientMutationId) was already
        // processed — e.g. the offline queue retried it after the response
        // was lost to a dropped connection — return the original result
        // instead of re-running tier checks / duplicate detection / insert.
        if (input.clientMutationId) {
          const existing = await db.getPatientByClientMutationId(input.clientMutationId);
          if (existing) {
            return { success: true, patientId: existing.patientId, duplicate: false, alreadySynced: true } as const;
          }
        }

        // ── Tier enforcement: monthly patient limit ──────────────────────
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        const limits = getClinicTierLimits(tier);
        if (limits.maxPatientsPerMonth !== null) {
          const thisMonth = await db.countPatientsThisMonth(ctx.user.clinicId);
          if (thisMonth >= limits.maxPatientsPerMonth) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `TIER_LIMIT_PATIENTS:${limits.maxPatientsPerMonth}:${tier}`,
            });
          }
        }

        const existing = await db.searchPatients(ctx.user.clinicId, input.firstName);
        // Normalise names before comparing: trim + case-fold, so "john " and
        // "John" (or the DB's null vs the form's undefined last name) are
        // recognised as the same person rather than slipping past as two
        // "different" patients due to formatting alone.
        const nameMatch = existing.find((p) => namesMatch(p.firstName, p.lastName, input.firstName, input.lastName));
        // A phone match is a strong signal even if the name was typed
        // differently (e.g. "Mohammed" vs "Muhammad") — this is a separate
        // lookup, not the name-filtered `existing` list, since a real dupe
        // under a different-looking name would never show up in that list.
        let phoneMatch: (typeof existing)[number] | undefined;
        if (input.phone) {
          const byPhone = await db.findPatientsByPhone(ctx.user.clinicId, normalizePhone(input.phone));
          phoneMatch = byPhone.find((p) => phonesMatch(p.phone, input.phone));
        }
        const duplicateMatch = nameMatch || phoneMatch;
        if (duplicateMatch && !input.forceCreate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: phoneMatch && !nameMatch ? "DUPLICATE_PATIENT_PHONE" : "DUPLICATE_PATIENT",
          });
        }

        const { patientId: newPatientId } = await db.createPatientWithGeneratedId(ctx.user.clinicId, {
          firstName: input.firstName,
          lastName: input.lastName || undefined,
          dateOfBirth: input.dateOfBirth || undefined,
          age: input.age,
          gender: input.gender,
          phone: input.phone,
          email: input.email || undefined,
          village: input.village,
          nextOfKin: input.nextOfKin,
          nextOfKinPhone: input.nextOfKinPhone,
          medicalHistory: input.medicalHistory,
          allergies: input.allergies,
          clientMutationId: input.clientMutationId,
        });

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "CREATE_PATIENT",
          entityType: "patient",
          entityId: undefined,
          changes: JSON.stringify({ patientId: newPatientId }),
        });

        // ── Approaching-limit email notification ─────────────────────────
        // Fire-and-forget: send once when hitting 80% and once at 100%.
        // Don't await — never block the response for a notification email.
        if (limits.maxPatientsPerMonth !== null) {
          const updatedCount = await db.countPatientsThisMonth(ctx.user.clinicId);
          const pct = Math.round((updatedCount / limits.maxPatientsPerMonth) * 100);
          const clinic = ctx.clinic;
          const managerEmail = ctx.user.email;
          const clinicName = clinic?.name ?? "your clinic";
          const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).getDate() - new Date().getDate();

          const safeClinicName = escapeHtml(clinicName);
          const safeUserName = escapeHtml(ctx.user.name);

          if (pct >= 100 && managerEmail) {
            sendEmail({
              to: managerEmail,
              subject: `[CareDesk] Patient limit reached — ${clinicName}`,
              html: `<p>Hi ${safeUserName},</p>
<p>You've reached the <strong>${limits.maxPatientsPerMonth}-patient monthly limit</strong> on the Free plan for <strong>${safeClinicName}</strong>.</p>
<p>No new patients can be registered until the counter resets in <strong>${daysLeft} day${daysLeft === 1 ? "" : "s"}</strong>.</p>
<p><a href="${ENV.appUrl}/settings" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Upgrade to Clinic (UGX 90,000/mo)</a></p>
<p style="color:#888;font-size:12px">Unlimited patient registrations are included in the Clinic plan.</p>`,
            }).catch(() => {}); // ignore email errors
          } else if (pct >= 80 && updatedCount === Math.floor(limits.maxPatientsPerMonth * 0.8) && managerEmail) {
            // Only send the 80% email exactly once (when crossing the threshold, not on every patient after)
            sendEmail({
              to: managerEmail,
              subject: `[CareDesk] Approaching patient limit — ${clinicName}`,
              html: `<p>Hi ${safeUserName},</p>
<p>You've used <strong>${updatedCount} of ${limits.maxPatientsPerMonth} patient registrations</strong> this month at <strong>${safeClinicName}</strong>.</p>
<p>You have <strong>${limits.maxPatientsPerMonth - updatedCount} registrations left</strong> before you hit the Free plan limit. The counter resets in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.</p>
<p><a href="${ENV.appUrl}/settings" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Upgrade to Clinic (UGX 90,000/mo)</a></p>`,
            }).catch(() => {});
          }
        }

        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number(), ...patientSchema.shape }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const patient = await db.getPatientById(input.id);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });

        await db.updatePatient(input.id, {
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: input.dateOfBirth || undefined,
          age: input.age,
          gender: input.gender,
          phone: input.phone,
          email: input.email,
          village: input.village,
          nextOfKin: input.nextOfKin,
          nextOfKinPhone: input.nextOfKinPhone,
          medicalHistory: input.medicalHistory,
          allergies: input.allergies,
        });

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "UPDATE_PATIENT",
          entityType: "patient",
          entityId: input.id,
        });

        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can delete patients" });
        }

        const patient = await db.getPatientById(input.id);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });

        await db.deletePatient(input.id);

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "DELETE_PATIENT",
          entityType: "patient",
          entityId: input.id,
        });

        return { success: true };
      }),

    getVisitHistory: protectedProcedure
      .input(z.object({ patientId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const patient = await db.getPatientById(input.patientId);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return await db.getVisitsByPatient(input.patientId);
      }),

    getFullHistory: protectedProcedure
      .input(z.object({ patientId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return await db.getPatientFullHistory(input.patientId, ctx.user.clinicId);
      }),

    getDebtors: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      return await db.getDebtors(ctx.user.clinicId);
    }),

    sendDebtReminder: protectedProcedure
      .input(z.object({ patientId: z.number(), amount: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        // Debt reminders are a manager-level financial action.
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can send debt reminders" });
        }
        const patient = await db.getPatientById(input.patientId);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        if (!getClinicTierLimits(tier).debtReminders) {
          throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:debtReminders:clinic" });
        }
        if (patient?.phone && clinic) {
          await sendAndLogSms({
            clinicId: ctx.user.clinicId,
            patient,
            message: smsTemplates.paymentReminder(patient.firstName, input.amount, clinic.name),
            countryCode: countryToDialCode(clinic.country),
            messageType: "payment_reminder",
          });
          return { sent: true };
        }
        return { sent: false, reason: "Patient has no phone number" };
      }),

    updateFlags: protectedProcedure
      .input(z.object({ id: z.number(), flags: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const patient = await db.getPatientById(input.id);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        await db.updatePatient(input.id, { flags: input.flags });
        return { success: true } as const;
      }),

    updateSmsOptOut: protectedProcedure
      .input(z.object({ id: z.number(), smsOptOut: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const patient = await db.getPatientById(input.id);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        await db.updatePatient(input.id, { smsOptOut: input.smsOptOut });
        return { success: true } as const;
      }),
  }),

  // Visit operations
  visit: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      return await db.getVisitsByClinic(ctx.user.clinicId);
    }),
    getByPatient: protectedProcedure
      .input(z.object({ patientId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const patient = await db.getPatientById(input.patientId);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return await db.getVisitsByPatient(input.patientId);
      }),
    create: protectedProcedure
      .input(visitSchema)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const allowedVisitCreators = ["doctor", "manager", "receptionist", "admin"];
        if (!allowedVisitCreators.includes(ctx.user.role)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to create visits" });
        }

        const patient = await db.getPatientById(input.patientId);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });

        // ── Offline-sync idempotency ───────────────────────────────────────
        // A visit create bundles the visit + lab tests + drug dispensing +
        // bill in one transaction. Replaying it would double-dispense stock
        // and double-bill the patient, so this check must happen before
        // anything else runs.
        if (input.clientMutationId) {
          const existing = await db.getVisitByClientMutationId(input.clientMutationId);
          if (existing) {
            return { success: true, alreadySynced: true } as const;
          }
        }

        // ── Tier enforcement: monthly visit limit ─────────────────────────
        // Independent from the patient-registration cap. Counts every visit
        // this month regardless of whether the patient is new or returning —
        // without this, a clinic with a small stable patient base could run
        // unlimited paid consultations through Free forever, since only
        // *new* registrations were ever capped.
        const clinicForLimit = ctx.clinic;
        const visitTier = getEffectiveTier(clinicForLimit as any);
        const visitLimits = getClinicTierLimits(visitTier);
        if (visitLimits.maxVisitsPerMonth !== null) {
          const visitsThisMonth = await db.countVisitsThisMonth(ctx.user.clinicId);
          if (visitsThisMonth >= visitLimits.maxVisitsPerMonth) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `TIER_LIMIT_VISITS:${visitLimits.maxVisitsPerMonth}:${visitTier}`,
            });
          }
        }

        const visitDate = new Date(input.visitDate);

        // ── Pre-flight: check drug stock before entering the transaction ──
        // Fail fast with a clear message rather than discovering it mid-write.
        if (input.prescribedDrugs && input.prescribedDrugs.length > 0) {
          for (const drug of input.prescribedDrugs) {
            if (!drug.drugId) continue;
            const drugRecord = await db.getDrugById(drug.drugId);
            if (!drugRecord) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `Drug not found: ${drug.drugName}` });
            }
            // Ownership check — prevent a user from referencing drug IDs belonging to another clinic
            if (drugRecord.clinicId !== ctx.user.clinicId) {
              throw new TRPCError({ code: "FORBIDDEN", message: `Drug not found: ${drug.drugName}` });
            }
            if (!drugRecord.isActive) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `${drug.drugName} has been removed from inventory and can't be prescribed.` });
            }
            if (drugRecord.quantity < drug.quantity) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Insufficient stock for ${drug.drugName}: ${drugRecord.quantity} available, ${drug.quantity} requested`,
              });
            }
            if (isDrugExpired(drugRecord.expiryDate, visitDate.getTime())) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${drug.drugName} expired on ${new Date(drugRecord.expiryDate).toLocaleDateString()} and cannot be dispensed. Remove it from stock in Drug Inventory.`,
              });
            }
          }
        }

        // ── All writes in a single transaction ────────────────────────────
        // tx is passed explicitly to every sub-function so they all run on
        // the same pool connection — true atomicity: rollback on any failure.
        //
        // Race note: the clientMutationId pre-check above only catches a
        // replay that arrives *after* the first one has already committed.
        // Two replays racing concurrently (e.g. two browser tabs on the same
        // device both draining the offline outbox at once) can both pass
        // that check and both reach this transaction. If that happens,
        // createVisitAndReturnId throws DuplicateMutationError instead of
        // quietly returning the winner's id — catch it here and stop, rather
        // than letting the loser re-run its own labs/drugs/bill steps
        // against a visit the winner already fully billed.
        let visitId: number, billId: string;
        try {
          ({ visitId, billId } = await db.withTransaction(async (tx) => {
          const newVisitId = await db.createVisitAndReturnId({
            clinicId: ctx.user.clinicId!,
            patientId: input.patientId,
            visitDate,
            chiefComplaint: input.chiefComplaint,
            clinicalNotes: input.clinicalNotes,
            prescriptionNotes: input.prescriptionNotes,
            diagnosis: input.diagnosis,
            consultationFee: input.consultationFee as any,
            doctorId: ctx.user.role === "doctor" ? ctx.user.id : undefined,
            receptionistId: ctx.user.role !== "doctor" ? ctx.user.id : undefined,
            status: "completed",
            clientMutationId: input.clientMutationId,
          }, tx);

          if (input.labTests && input.labTests.length > 0) {
            for (const test of input.labTests) {
              await db.createLabTest({ visitId: newVisitId, testName: test.testName, cost: test.cost as any }, tx);
            }
          }

          let drugTotal = 0;
          if (input.prescribedDrugs && input.prescribedDrugs.length > 0) {
            for (const drug of input.prescribedDrugs) {
              const totalCost = drug.costPerUnit * drug.quantity;
              drugTotal += totalCost;

              await db.createPrescribedDrug({
                visitId: newVisitId,
                drugId: drug.drugId,
                drugName: drug.drugName,
                dosage: drug.dosage,
                quantity: drug.quantity,
                unit: drug.unit,
                costPerUnit: drug.costPerUnit as any,
                totalCost: totalCost as any,
                instructions: drug.instructions,
              }, tx);

              if (drug.drugId) {
                // Atomic stock deduction — race-safe, no read-modify-write
                const { success, previousQuantity, newQuantity } = await db.deductDrugStockAtomic(drug.drugId, drug.quantity, tx);
                if (!success) {
                  // Another concurrent request beat us to the stock — roll back
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: `Insufficient stock for ${drug.drugName} — it may have just been dispensed by another staff member. Please check inventory.`,
                  });
                }
                await db.createDrugStockHistory({
                  drugId: drug.drugId,
                  transactionType: "deduct",
                  quantityChanged: drug.quantity,
                  previousQuantity,
                  newQuantity,
                  reason: "Prescribed in visit",
                  userId: ctx.user.id,
                  visitId: newVisitId, // link the deduction back to the visit that caused it
                }, tx);
              }
            }
          }

          const labTotal = (input.labTests || []).reduce((sum, t) => sum + t.cost, 0);
          const billNumber = await db.getNextBillNumber(ctx.user.clinicId!, tx);
          const grandTotal = input.consultationFee + labTotal + drugTotal;

          await db.createBill({
            clinicId: ctx.user.clinicId!,
            patientId: input.patientId,
            visitId: newVisitId,
            billNumber,
            consultationFee: input.consultationFee as any,
            labTotal: labTotal as any,
            drugTotal: drugTotal as any,
            grandTotal: grandTotal as any,
            amountPaid: 0 as any,
            balanceAmount: grandTotal as any,
            paymentStatus: "unpaid",
            billDate: new Date(),
          }, tx);

          return { visitId: newVisitId, billId: billNumber };
          }));
        } catch (error) {
          if (error instanceof db.DuplicateMutationError) {
            // Lost the race to a concurrent replay of the same offline
            // write — the winner already created this visit (and its
            // labs/drugs/bill) in full. Report success without redoing any
            // of it.
            return { success: true, alreadySynced: true } as const;
          }
          throw error;
        }

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "CREATE_VISIT",
          entityType: "visit",
          entityId: visitId,
        });

        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        chiefComplaint: z.string().optional(),
        clinicalNotes: z.string().optional(),
        prescriptionNotes: z.string().optional(),
        diagnosis: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const visit = await db.getVisitById(input.id);
        if (visit?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        // Only managers and admins can edit completed visits; doctors/receptionists cannot.
        if (visit.status === "completed" && ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This visit has been completed and is locked. Contact a manager to edit." });
        }
        const { id, ...updates } = input;
        await db.updateVisit(id, updates);
        return { success: true } as const;
      }),

    flagFollowUp: protectedProcedure
      .input(z.object({
        id: z.number(),
        followUpFlag: z.boolean(),
        followUpDate: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const visit = await db.getVisitById(input.id);
        if (visit?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        await db.updateVisit(input.id, {
          followUpFlag: input.followUpFlag,
          followUpDate: input.followUpDate ? input.followUpDate : undefined,
        });
        if (input.followUpFlag) {
          const patient = await db.getPatientById(visit.patientId);
          const clinic = ctx.clinic;
          if (patient?.phone && clinic && input.followUpDate) {
            const dateStr = new Date(input.followUpDate).toLocaleDateString("en-UG", {
              weekday: "long", day: "numeric", month: "long",
            });
            await sendAndLogSms({
              clinicId: ctx.user.clinicId,
              patient,
              message: `Dear ${patient.firstName}, your doctor has scheduled a follow-up visit for you at ${clinic.name} on ${dateStr}. Please come in or call us to confirm.`,
              countryCode: countryToDialCode(clinic.country),
              messageType: "appointment_reminder",
            });
          }
        }
        return { success: true } as const;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const visit = await db.getVisitById(input.id);
        if (visit?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return visit;
      }),
  }),

  // Drug operations
  drug: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      const clinic = ctx.clinic;
      const tier = getEffectiveTier(clinic as any);
      if (!getClinicTierLimits(tier).drugInventory) {
        throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:drugInventory:clinic" });
      }
      return await db.getDrugsByClinic(ctx.user.clinicId);
    }),

    stockHistory: protectedProcedure
      .input(z.object({ drugId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        if (!getClinicTierLimits(tier).drugInventory) {
          throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:drugInventory:clinic" });
        }
        const drug = await db.getDrugById(input.drugId);
        if (drug?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return await db.getDrugStockHistory(input.drugId);
      }),

    search: protectedProcedure
      .use(rateLimited(60, 60_000))
      .input(z.object({ query: z.string() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        if (!getClinicTierLimits(tier).drugInventory) {
          throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:drugInventory:clinic" });
        }
        return await db.searchDrugs(ctx.user.clinicId, input.query);
      }),

    create: protectedProcedure
      .input(drugSchema)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can manage drugs" });
        }
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        if (!getClinicTierLimits(tier).drugInventory) {
          throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:drugInventory:clinic" });
        }

        await db.createDrug({
          clinicId: ctx.user.clinicId,
          drugName: input.drugName,
          genericName: input.genericName,
          quantity: input.quantity,
          unit: input.unit,
          costPerUnit: input.costPerUnit as any,
          sellingPrice: input.sellingPrice as any,
          lowStockThreshold: input.lowStockThreshold,
          expiryDate: input.expiryDate || undefined,
          batchNumber: input.batchNumber,
          supplier: input.supplier,
        });

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "CREATE_DRUG",
          entityType: "drug",
          entityId: undefined,
        });

        return { success: true };
      }),

    restock: protectedProcedure
      .input(z.object({ drugId: z.number(), quantity: z.number().min(1, "Restock quantity must be at least 1") }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const drug = await db.getDrugById(input.drugId);
        if (drug?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        if (!getClinicTierLimits(tier).drugInventory) {
          throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:drugInventory:clinic" });
        }

        // Atomic addition — safe under concurrent restocks
        const { previousQuantity, newQuantity } = await db.addDrugStockAtomic(input.drugId, input.quantity);

        await db.createDrugStockHistory({
          drugId: input.drugId,
          transactionType: "restock",
          quantityChanged: input.quantity,
          previousQuantity,
          newQuantity,
          reason: "Restock",
          userId: ctx.user.id,
          visitId: undefined,
        });

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "RESTOCK_DRUG",
          entityType: "drug",
          entityId: input.drugId,
        });

        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ drugId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        // Soft delete (db.deleteDrug sets isActive: false, same pattern as
        // patients) — restrict to managers, consistent with drug.create.
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can remove drugs from inventory" });
        }
        const drug = await db.getDrugById(input.drugId);
        if (drug?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        if (!getClinicTierLimits(tier).drugInventory) {
          throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:drugInventory:clinic" });
        }

        await db.deleteDrug(input.drugId);

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "DELETE_DRUG",
          entityType: "drug",
          entityId: input.drugId,
        });

        return { success: true };
      }),
  }),

  // Bill operations
  bill: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(500).optional(), offset: z.number().min(0).optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return await db.getBillsByClinic(ctx.user.clinicId, input?.limit ?? 100, input?.offset ?? 0);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const bill = await db.getBillById(input.id);
        if (bill?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return bill;
      }),

    markAsPaid: protectedProcedure
      .input(z.object({
        billId: z.number(),
        amountPaid: z.number().min(0.01, "Payment amount must be greater than zero"),
        paymentMethod: z.enum(["cash", "mtn_momo", "bank_transfer", "cheque"]).default("cash"),
        clientMutationId: z.string().uuid().optional(), // offline-sync idempotency key
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const bill = await db.getBillById(input.billId);
        if (bill?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });

        // ── Offline-sync idempotency ───────────────────────────────────────
        // This mutation applies a *delta* (adds amountPaid to the running
        // total) rather than setting an absolute value, so a naive retry
        // would double-charge the payment onto the bill. Must check first.
        if (input.clientMutationId) {
          const existing = await db.getPaymentByClientMutationId(input.clientMutationId);
          if (existing) {
            return { success: true, alreadySynced: true } as const;
          }
        }

        const currentBalance = Number(bill.grandTotal) - Number(bill.amountPaid || 0);
        const validation = validatePaymentAmount(input.amountPaid, currentBalance);
        if (!validation.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: validation.error === "Amount exceeds outstanding balance"
              ? `Payment of ${input.amountPaid.toLocaleString()} exceeds the outstanding balance of ${currentBalance.toLocaleString()}. Double-check the amount — CareDesk doesn't track patient credit for overpayments.`
              : validation.error,
          });
        }

        const totalAmountPaid = Number(bill.amountPaid || 0) + input.amountPaid;
        const balanceAmount = Number(bill.grandTotal) - totalAmountPaid;
        const paymentStatus =
          balanceAmount <= 0 ? "paid" : balanceAmount < Number(bill.grandTotal) ? "partial" : "unpaid";

        // Wrap bill update + payment record in a transaction.
        // If createPayment fails, the bill update rolls back — no ghost payments.
        // tx is passed explicitly so both operations run on the same connection.
        try {
          await db.withTransaction(async (tx) => {
            await db.updateBill(input.billId, {
              amountPaid: totalAmountPaid as any,
              balanceAmount: Math.max(0, balanceAmount) as any,
              paymentStatus: paymentStatus as any,
              paidDate: paymentStatus === "paid" ? new Date() : undefined,
            }, tx);

            await db.createPayment({
              billId: input.billId,
              amount: input.amountPaid as any,
              paymentMethod: input.paymentMethod,
              paymentDate: new Date(),
              status: "confirmed",
              clientMutationId: input.clientMutationId,
            }, tx);
          });
        } catch (error: any) {
          // A concurrent replay of the same offline-queued payment won the
          // race — the transaction rolled back cleanly (no double delta
          // applied), and the original submission's transaction already
          // committed the real payment. Report that success rather than an
          // error the offline queue would otherwise mark "needs review" for
          // a write that in fact went through.
          if (input.clientMutationId && db.isDuplicateOnColumn(error, "clientMutationId")) {
            const existing = await db.getPaymentByClientMutationId(input.clientMutationId);
            if (existing) return { success: true, alreadySynced: true } as const;
          }
          throw error;
        }

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "MARK_BILL_PAID",
          entityType: "bill",
          entityId: input.billId,
        });

        // SMS payment confirmation to patient
        const patientRecord = await db.getPatientById(bill.patientId);
        const clinicForSms = ctx.clinic;
        if (patientRecord?.phone) {
          await sendAndLogSms({
            clinicId: ctx.user.clinicId,
            patient: patientRecord,
            message: smsTemplates.paymentReceived(patientRecord.firstName, input.amountPaid, Math.max(0, balanceAmount)),
            countryCode: countryToDialCode(clinicForSms?.country),
            messageType: "payment_receipt",
            billId: input.billId,
          });
        }

        return { success: true };
      }),

    markAsUnpaid: protectedProcedure
      .input(z.object({ billId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        // Resetting a bill deletes payment records — restrict to managers only.
        // Without this check, any receptionist or doctor can silently erase payment history.
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can reset bill payment status" });
        }
        const bill = await db.getBillById(input.billId);
        if (bill?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });

        // Delete payment records for this bill so the daily reconciliation
        // doesn't double-count if the patient repays after being reset to unpaid.
        await db.deletePaymentsByBill(input.billId);

        await db.updateBill(input.billId, {
          amountPaid: 0 as any,
          balanceAmount: bill.grandTotal as any,
          paymentStatus: "unpaid" as any,
          paidDate: undefined,
        });

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "MARK_BILL_UNPAID",
          entityType: "bill",
          entityId: input.billId,
        });

        return { success: true };
      }),

    void: protectedProcedure
      .input(z.object({ billId: z.number(), reason: z.string().min(1, "Reason is required") }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can void bills" });
        }
        const bill = await db.getBillById(input.billId);
        if (bill?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (bill.paymentStatus === "paid") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot void a fully paid bill" });
        }

        // Mark as void: zero out all amounts so the bill is invisible to revenue reports.
        // amountPaid MUST also be zeroed — otherwise the void bill is counted as revenue
        // in getDailyReconciliation and getTodayStats (both filter on paymentStatus="paid"
        // and sum amountPaid).
        //
        // The original amounts are captured in the audit log BEFORE being zeroed. Without
        // this, voiding destroys the only record of what the bill was worth — if a manager
        // needs to check a voided bill's original total later (a discrepancy investigation,
        // an owner questioning a write-off), there would be nothing to check it against
        // except whatever free-text reason was typed in at the time.
        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "VOID_BILL",
          entityType: "bill",
          entityId: input.billId,
          changes: JSON.stringify({
            reason: input.reason,
            before: {
              grandTotal: bill.grandTotal,
              amountPaid: bill.amountPaid,
              balanceAmount: bill.balanceAmount,
              paymentStatus: bill.paymentStatus,
            },
          }),
        });

        await db.updateBill(input.billId, {
          grandTotal: 0 as any,
          amountPaid: 0 as any,
          balanceAmount: 0 as any,
          paymentStatus: "paid" as any,
          isVoided: true,
          notes: `VOIDED: ${input.reason}`,
        });

        return { success: true } as const;
      }),

    dailyCash: protectedProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        if (!getClinicTierLimits(tier).reports) {
          throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:reports:clinic" });
        }
        return await db.getDailyReconciliation(ctx.user.clinicId, new Date(input.date));
      }),

    payments: protectedProcedure
      .input(z.object({ billId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const bill = await db.getBillById(input.billId);
        if (bill?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return await db.getPaymentsByBill(input.billId);
      }),

    delete: protectedProcedure
      .input(z.object({ billId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can delete bills" });
        }
        const bill = await db.getBillById(input.billId);
        if (bill?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        // A bill with any payment history must be voided, not hard-deleted —
        // deleting it would leave those payment rows pointing at a billId
        // that no longer exists (no FK/cascade enforces this at the DB
        // layer), silently corrupting the financial audit trail. This is
        // exactly the failure mode the isVoided flag (migration 0005) was
        // introduced to prevent for the void path; delete must honor the
        // same guarantee.
        const existingPayments = await db.getPaymentsByBill(input.billId);
        if (existingPayments.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This bill has payment history and can't be deleted. Use void instead to preserve the audit trail.",
          });
        }
        await db.deleteBill(input.billId);
        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "DELETE_BILL",
          entityType: "bill",
          entityId: input.billId,
        });
        return { success: true };
      }),
  }),

  // Appointment operations
  appointment: router({
    list: protectedProcedure
      .input(z.object({ fromDate: z.string(), toDate: z.string() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        return await db.getAppointmentsByClinic(
          ctx.user.clinicId,
          new Date(input.fromDate),
          new Date(input.toDate)
        );
      }),

    create: protectedProcedure
      .input(appointmentSchema)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const patient = await db.getPatientById(input.patientId);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });

        // ── Offline-sync idempotency ───────────────────────────────────────
        if (input.clientMutationId) {
          const existing = await db.getAppointmentByClientMutationId(input.clientMutationId);
          if (existing) {
            return { success: true, alreadySynced: true } as const;
          }
        }

        let appointmentId: number;
        if (input.assignedDoctor && !input.forceCreate) {
          // Lock the doctor's row for the duration of this transaction so a
          // concurrent booking request for the same doctor has to wait for
          // this one to commit before running its own conflict check —
          // otherwise two near-simultaneous requests can both pass the
          // check and both insert, double-booking the doctor.
          appointmentId = await db.withTransaction(async (tx) => {
            await db.lockDoctorForBooking(tx, input.assignedDoctor!);
            const conflicts = await db.getConflictingAppointments(
              ctx.user.clinicId!,
              input.assignedDoctor!,
              new Date(input.appointmentDate),
              input.duration,
              undefined,
              tx
            );
            if (conflicts.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: `This doctor already has an appointment at ${new Date(conflicts[0].appointmentDate).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })} that overlaps this time slot.`,
              });
            }
            return await db.createAppointmentAndReturnId({
              clinicId: ctx.user.clinicId!,
              patientId: input.patientId,
              appointmentDate: new Date(input.appointmentDate),
              duration: input.duration,
              reason: input.reason,
              notes: input.notes,
              assignedDoctor: input.assignedDoctor,
              status: "scheduled",
              clientMutationId: input.clientMutationId,
            }, tx);
          });
        } else {
          appointmentId = await db.createAppointmentAndReturnId({
            clinicId: ctx.user.clinicId,
            patientId: input.patientId,
            appointmentDate: new Date(input.appointmentDate),
            duration: input.duration,
            reason: input.reason,
            notes: input.notes,
            assignedDoctor: input.assignedDoctor,
            status: "scheduled",
            clientMutationId: input.clientMutationId,
          });
        }

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "CREATE_APPOINTMENT",
          entityType: "appointment",
          entityId: appointmentId,
        });

        // SMS reminder to patient (reuse the `patient` fetched and validated above)
        const clinic = ctx.clinic;
        if (patient?.phone && clinic) {
          const apptDate = new Date(input.appointmentDate).toLocaleString("en-UG", {
            weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
          });
          await sendAndLogSms({
            clinicId: ctx.user.clinicId,
            patient,
            message: smsTemplates.appointmentReminder(patient.firstName, apptDate, clinic.name),
            countryCode: countryToDialCode(clinic.country),
            messageType: "appointment_reminder",
            appointmentId,
          });
        }

        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number(), status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const appointment = await db.getAppointmentById(input.id);
        if (appointment?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });

        await db.updateAppointment(input.id, { status: input.status });

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "UPDATE_APPOINTMENT",
          entityType: "appointment",
          entityId: input.id,
        });

        return { success: true };
      }),

    today: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const apts = await db.getAppointmentsByClinic(ctx.user.clinicId, start, end);
      // Doctor sees only their own; everyone else sees all
      if (ctx.user.role === "doctor") {
        return apts.filter((a) => a.assignedDoctor === ctx.user.id);
      }
      return apts;
    }),

    reschedule: protectedProcedure
      .input(z.object({ id: z.number(), newDate: z.string(), forceReschedule: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const appointment = await db.getAppointmentById(input.id);
        if (appointment?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (appointment.status === "completed" || appointment.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reschedule a completed or cancelled appointment" });
        }

        const newDate = new Date(input.newDate);

        if (appointment.assignedDoctor && !input.forceReschedule) {
          // Same race as appointment.create, same fix: lock the doctor's
          // row for the transaction so a concurrent reschedule/booking for
          // this doctor can't slip past the conflict check between it and
          // the update below.
          await db.withTransaction(async (tx) => {
            await db.lockDoctorForBooking(tx, appointment.assignedDoctor!);
            const conflicts = await db.getConflictingAppointments(
              ctx.user.clinicId!,
              appointment.assignedDoctor!,
              newDate,
              appointment.duration,
              appointment.id,
              tx
            );
            if (conflicts.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: `This doctor already has an appointment at ${new Date(conflicts[0].appointmentDate).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })} that overlaps this new time.`,
              });
            }
            await db.updateAppointment(input.id, { appointmentDate: newDate, status: "scheduled" }, tx);
          });
        } else {
          await db.updateAppointment(input.id, { appointmentDate: newDate, status: "scheduled" });
        }

        // Send new confirmation SMS to patient
        const patient = await db.getPatientById(appointment.patientId);
        const clinic = ctx.clinic;
        if (patient?.phone && clinic) {
          const apptDate = newDate.toLocaleString("en-UG", {
            weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
          });
          await sendAndLogSms({
            clinicId: ctx.user.clinicId,
            patient,
            message: smsTemplates.appointmentReminder(patient.firstName, apptDate, clinic.name),
            countryCode: countryToDialCode(clinic.country),
            messageType: "appointment_reminder",
            appointmentId: appointment.id,
          });
        }

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "RESCHEDULE_APPOINTMENT",
          entityType: "appointment",
          entityId: appointment.id,
        });

        return { success: true } as const;
      }),

    walkIn: protectedProcedure
      .input(z.object({ patientId: z.number(), reason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        const patient = await db.getPatientById(input.patientId);
        if (patient?.clinicId !== ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });

        const appointmentId = await db.createAppointmentAndReturnId({
          clinicId: ctx.user.clinicId,
          patientId: input.patientId,
          appointmentDate: new Date(),
          duration: 30,
          reason: input.reason || "Walk-in",
          status: "confirmed",
        });

        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "WALKIN_APPOINTMENT",
          entityType: "appointment",
          entityId: appointmentId,
        });

        return { success: true, appointmentId } as const;
      }),
  }),

  // ===== STAFF MANAGEMENT =====
  staff: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can view staff" });
      }
      const staffList = await db.getUsersByClinic(ctx.user.clinicId);
      return staffList.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        isActive: u.isActive,
        lastSignedIn: u.lastSignedIn,
        createdAt: u.createdAt,
      }));
    }),

    updateRole: protectedProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["receptionist", "doctor", "manager"]) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can change staff roles" });
        }
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot change your own role" });
        }
        const target = await db.getUserByIdAndClinic(input.userId, ctx.user.clinicId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found" });
        // Protect the platform admin account from role changes by a clinic manager
        if (target.role === "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "This account cannot be modified" });
        }

        await db.updateUserRole(input.userId, input.role);
        // Bump session version so the user's existing JWT is immediately invalid.
        // They will be forced to log in again and pick up their new role and permissions.
        await db.bumpSessionVersion(input.userId);
        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: "UPDATE_STAFF_ROLE",
          entityType: "user",
          entityId: input.userId,
        });
        return { success: true } as const;
      }),

    setActive: protectedProcedure
      .input(z.object({ userId: z.number(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can deactivate staff" });
        }
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot deactivate your own account" });
        }
        const target = await db.getUserByIdAndClinic(input.userId, ctx.user.clinicId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found" });
        // Protect the platform admin account from being deactivated by a clinic manager
        if (target.role === "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "This account cannot be modified" });
        }

        await db.updateUserActiveStatus(input.userId, input.isActive);
        await db.logActivity({
          clinicId: ctx.user.clinicId,
          userId: ctx.user.id,
          action: input.isActive ? "REACTIVATE_STAFF" : "DEACTIVATE_STAFF",
          entityType: "user",
          entityId: input.userId,
        });
        return { success: true } as const;
      }),

    listPendingInvites: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return await db.getPendingInvitesByClinic(ctx.user.clinicId);
    }),

    invite: protectedProcedure
      .input(staffInviteSchema)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can invite staff" });
        }

        const clinic = ctx.clinic;

        // ── Tier enforcement: staff limit ────────────────────────────────
        const tier = getEffectiveTier(clinic as any);
        if (!hasUnlimitedStaff(tier)) {
          const limits = getClinicTierLimits(tier);
          const currentStaff = await db.countActiveStaff(ctx.user.clinicId);
          if (currentStaff >= limits.maxStaff) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `TIER_LIMIT_STAFF:${limits.maxStaff}:${tier}`,
            });
          }
        }

        const token = randomBytes(24).toString("hex");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.createInviteAndReturnId({
          clinicId: ctx.user.clinicId,
          email: input.email,
          phone: input.phone,
          role: input.role,
          token,
          invitedBy: ctx.user.id,
          expiresAt,
        });

        const link = buildInviteLink(ctx.req, token);
        const clinicName = clinic?.name ?? "your clinic";

        let smsStatus: string | undefined;
        let emailStatus: string | undefined;

        if (input.phone) {
          const result = await sendSMS(input.phone, smsTemplates.staffInvite(clinicName, input.role, link), countryToDialCode(clinic?.country));
          smsStatus = result.status;
        }
        if (input.email) {
          const tmpl = emailTemplates.staffInvite(clinicName, input.role, link);
          const result = await sendEmail({ to: input.email, subject: tmpl.subject, html: tmpl.html });
          emailStatus = result.status;
        }

        return { success: true, inviteLink: link, smsStatus, emailStatus } as const;
      }),

    resendInvite: protectedProcedure
      .input(z.object({ inviteId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const invite = await db.getInviteById(input.inviteId);
        if (!invite || invite.clinicId !== ctx.user.clinicId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
        }
        if (invite.usedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This invite has already been accepted" });
        }

        const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.updateInviteExpiry(invite.id, newExpiresAt);

        const clinic = ctx.clinic;
        const link = buildInviteLink(ctx.req, invite.token);
        const clinicName = clinic?.name ?? "your clinic";

        let smsStatus: string | undefined;
        let emailStatus: string | undefined;

        if (invite.phone) {
          const result = await sendSMS(invite.phone, smsTemplates.staffInvite(clinicName, invite.role, link), countryToDialCode(clinic?.country));
          smsStatus = result.status;
        }
        if (invite.email) {
          const tmpl = emailTemplates.staffInvite(clinicName, invite.role, link);
          const result = await sendEmail({ to: invite.email, subject: tmpl.subject, html: tmpl.html });
          emailStatus = result.status;
        }

        return { success: true, inviteLink: link, smsStatus, emailStatus } as const;
      }),

    cancelInvite: protectedProcedure
      .input(z.object({ inviteId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const invite = await db.getInviteById(input.inviteId);
        if (!invite || invite.clinicId !== ctx.user.clinicId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
        }
        await db.deleteInvite(invite.id);
        return { success: true } as const;
      }),

    // ----- Public: invite acceptance (user is not authenticated yet) -----

    getInviteInfo: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const invite = await db.getInviteByToken(input.token);
        if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
          return { valid: false } as const;
        }
        const clinic = await db.getClinicById(invite.clinicId);
        return {
          valid: true,
          clinicName: clinic?.name ?? "your clinic",
          role: invite.role,
          email: invite.email,
        } as const;
      }),

    acceptInvite: publicProcedure
      .input(z.object({
        token: z.string(),
        name: z.string().min(1, "Name is required").max(255),
        email: z.string().email("Enter a valid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }))
      .mutation(async ({ ctx, input }) => {
        const invite = await db.getInviteByToken(input.token);
        if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link is invalid or has expired" });
        }

        // If the invite was sent to a specific email address, the person
        // accepting it must use that same address. This prevents someone who
        // intercepts or forwards the link from joining under a different identity.
        if (invite.email && invite.email.toLowerCase() !== input.email.toLowerCase()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invite was sent to a different email address. Please use the correct email to accept it.",
          });
        }

        const existing = await db.getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists" });
        }

        // Re-check staff limit at acceptance time — the clinic's tier may have changed
        // (e.g. downgraded) since the invite was originally sent.
        const inviteClinic = await db.getClinicById(invite.clinicId);
        const inviteTier = getEffectiveTier(inviteClinic as any);
        if (!hasUnlimitedStaff(inviteTier)) {
          const inviteLimits = getClinicTierLimits(inviteTier);
          const currentStaff = await db.countActiveStaff(invite.clinicId);
          if (currentStaff >= inviteLimits.maxStaff) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "This clinic has reached its staff limit. Ask the manager to upgrade the plan before you can join.",
            });
          }
        }

        const passwordHash = await hashPassword(input.password);
        const userId = await db.createUserAndReturnId({
          openId: randomUUID(),
          email: input.email,
          name: input.name,
          passwordHash,
          loginMethod: "password",
          role: invite.role,
          clinicId: invite.clinicId,
          lastSignedIn: new Date(),
        });

        await db.markInviteUsed(invite.id);
        await setSessionCookie(ctx.req, ctx.res, userId);

        // Log the new staff join and send them a welcome email
        await db.logActivity({
          clinicId: invite.clinicId,
          userId,
          action: "ACCEPT_INVITE",
          entityType: "user",
          entityId: userId,
        });
        const clinicName = inviteClinic?.name ?? "your clinic";
        const welcomeTmpl = emailTemplates.welcome(clinicName, input.name);
        void sendEmail({ to: input.email, subject: welcomeTmpl.subject, html: welcomeTmpl.html }).catch(() => {});

        return { success: true } as const;
      }),
  }),

  // ===== OWNER ADMIN ROUTES =====
  admin: router({
    getStats: ownerProcedure.query(() =>
      db.getOwnerRevenueStats()
    ),
    getAllClinics: ownerProcedure.query(() =>
      db.getAllClinicsWithStats()
    ),
    getClinicStaff: ownerProcedure
      .input(z.object({ clinicId: z.number() }))
      .query(async ({ input }) => {
        const staffList = await db.getUsersByClinic(input.clinicId);
        return staffList.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
        }));
      }),
    updateStatus: ownerProcedure.input(z.object({
      clinicId: z.number(),
      status: z.enum(["active", "inactive", "suspended"]),
    })).mutation(async ({ ctx, input }) => {
      // Clear any stale gracePeriodEndsAt from a previous failed-payment webhook.
      // Without this, a clinic already sitting in an unexpired grace period would
      // keep its 3-day grace access even after an admin explicitly suspends it —
      // getClinicAccessStatus checks gracePeriodEndsAt before honouring "suspended".
      await db.updateClinicBillingInfo(input.clinicId, {
        subscriptionStatus: input.status,
        gracePeriodEndsAt: null,
      });
      await db.logActivity({
        clinicId: input.clinicId,
        userId: ctx.user.id,
        action: "ADMIN_UPDATE_CLINIC_STATUS",
        entityType: "clinic",
        entityId: input.clinicId,
        changes: JSON.stringify({ newStatus: input.status }),
      });
      return { success: true } as const;
    }),

    // Manual tier correction — needed because the webhook deliberately
    // refuses to auto-upgrade when it can't confidently match a variant_id
    // (see lemonsqueezy.ts), which is the right call for safety but means
    // someone has to be able to fix it by hand afterwards. Without this,
    // the only way to correct a clinic's tier was a direct DB edit.
    updateClinicTier: ownerProcedure.input(z.object({
      clinicId: z.number(),
      tier: z.enum(["free", "clinic", "pro"]),
    })).mutation(async ({ ctx, input }) => {
      const clinic = await db.getClinicById(input.clinicId);
      if (!clinic) throw new TRPCError({ code: "NOT_FOUND" });
      const previousTier = getEffectiveTier(clinic);
      await db.updateClinicBillingInfo(input.clinicId, { subscriptionTier: input.tier });
      await db.syncBranchTiersToOwner(input.clinicId, { subscriptionTier: input.tier });
      await db.logActivity({
        clinicId: input.clinicId,
        userId: ctx.user.id,
        action: "ADMIN_UPDATE_CLINIC_TIER",
        entityType: "clinic",
        entityId: input.clinicId,
        changes: JSON.stringify({ fromTier: previousTier, toTier: input.tier }),
      });
      if (previousTier !== input.tier) {
        await db.logSubscriptionEvent({
          clinicId: input.clinicId,
          eventType: (["free", "clinic", "pro"].indexOf(input.tier) > ["free", "clinic", "pro"].indexOf(previousTier)) ? "upgraded" : "downgraded",
          fromTier: previousTier,
          toTier: input.tier,
          note: `Manually corrected by admin (${ctx.user.name})`,
        });
      }
      return { success: true } as const;
    }),

    // Gap #2: billing issues that previously only reached console.error.
    getBillingIssues: ownerProcedure.query(() => db.getSubscriptionEventsNeedingReview()),

    resolveBillingIssue: ownerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ ctx, input }) => db.resolveSubscriptionEvent(input.id, ctx.user.id)),

    // Gap #4: multi-admin support — previously "admin" was only ever
    // assigned automatically to whoever registered first on the platform,
    // with no product path to grant it to anyone else.
    promoteToAdmin: ownerProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const target = await db.getUserById(input.userId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        if (target.role === "admin") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Already an admin" });
        }
        await db.promoteUserToAdmin(input.userId);
        if (target.clinicId) {
          await db.logActivity({
            clinicId: target.clinicId,
            userId: ctx.user.id,
            action: "ADMIN_PROMOTE_ADMIN",
            entityType: "user",
            entityId: target.id,
            changes: JSON.stringify({ targetName: target.name, promotedFrom: target.role }),
          });
        }
        return { success: true } as const;
      }),

    // Gap #5: platform-wide audit log — the ADMIN_* actions above already
    // get written to activityLog, but scoped per-clinic and tier-gated for
    // reading, so an admin could never actually see their own action
    // history in one place. This reads across all clinics regardless of tier.
    getAuditLog: ownerProcedure.query(() => db.getAdminAuditLog()),

    // Manual trigger for server/backup.ts — the scheduled path
    // (system.runScheduledBackup) needs an external cron to actually be
    // configured; this button works immediately with no extra setup.

    // ─── MTN MoMo activation codes ───────────────────────────────────────────
    // After a clinic pays via MTN Mobile Money (often using WhatsApp number as
    // the MoMo "reason"), the platform admin generates a one-time code that
    // encodes tier + duration. The clinic redeems it under Settings.
    
    listPaymentRequests: ownerProcedure.query(() => db.listRecentPaymentRequests(100)),

    listPendingPaymentRequests: ownerProcedure.query(() => db.listPendingPaymentRequests(100)),

    /**
     * One-click: confirm MoMo payment and activate the clinic's plan immediately.
     * No activation code for the clinic to type — status flips to paid tier now.
     */
    approvePaymentRequest: ownerProcedure
      .input(z.object({
        id: z.number(),
        reviewNote: z.string().max(500).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const req = await db.getPaymentRequestById(input.id);
        if (!req) throw new TRPCError({ code: "NOT_FOUND" });
        if (req.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Request is already ${req.status}` });
        }

        const clinic = await db.getClinicById(req.clinicId);
        if (!clinic) throw new TRPCError({ code: "NOT_FOUND", message: "Clinic not found" });

        const previousTier = getEffectiveTier(clinic);
        const now = Date.now();
        const baseMs =
          clinic.subscriptionRenewsAt && clinic.subscriptionRenewsAt.getTime() > now
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

        await db.updatePaymentRequestStatus(input.id, {
          status: "approved",
          reviewedByUserId: ctx.user.id,
          reviewedAt: new Date(),
          reviewNote: input.reviewNote?.trim() || null,
          appliedUntil,
        });

        await db.logSubscriptionEvent({
          clinicId: req.clinicId,
          eventType: "upgraded",
          fromTier: previousTier,
          toTier: req.tier,
          note: `Payment request #${req.id} approved (MTN MoMo self-service) — ${req.durationMonths} month(s)`,
          needsReview: false,
        });

        await db.logActivity({
          clinicId: req.clinicId,
          userId: ctx.user.id,
          action: "ADMIN_APPROVE_PAYMENT_REQUEST",
          entityType: "payment_request",
          entityId: req.id,
          changes: JSON.stringify({ tier: req.tier, durationMonths: req.durationMonths, appliedUntil: appliedUntil.toISOString() }),
        });

        return { success: true as const, tier: req.tier, appliedUntil };
      }),

    rejectPaymentRequest: ownerProcedure
      .input(z.object({
        id: z.number(),
        reviewNote: z.string().min(1).max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        const req = await db.getPaymentRequestById(input.id);
        if (!req) throw new TRPCError({ code: "NOT_FOUND" });
        if (req.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Request is already ${req.status}` });
        }
        await db.updatePaymentRequestStatus(input.id, {
          status: "rejected",
          reviewedByUserId: ctx.user.id,
          reviewedAt: new Date(),
          reviewNote: input.reviewNote.trim(),
        });
        await db.logActivity({
          clinicId: req.clinicId,
          userId: ctx.user.id,
          action: "ADMIN_REJECT_PAYMENT_REQUEST",
          entityType: "payment_request",
          entityId: req.id,
          changes: JSON.stringify({ reviewNote: input.reviewNote }),
        });
        return { success: true } as const;
      }),

generateActivationCode: ownerProcedure
      .input(z.object({
        tier: z.enum(["clinic", "pro"]),
        durationMonths: z.number().int().min(1).max(36),
        amountUgx: z.number().int().min(0).optional(),
        payerPhone: z.string().max(30).optional(),
        note: z.string().max(500).optional(),
        /** Days until unused code expires (default 14) */
        codeValidDays: z.number().int().min(1).max(90).default(14),
      }))
      .mutation(async ({ ctx, input }) => {
        // CD-TIER-XXXX-XXXX — readable, no ambiguous chars (0/O, 1/I)
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const rand = (n: number) =>
          Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join("");
        const tierTag = input.tier === "pro" ? "PRO" : "CLN";
        let code = "";
        for (let attempt = 0; attempt < 8; attempt++) {
          code = `CD-${tierTag}-${rand(4)}-${rand(4)}`;
          const existing = await db.getActivationCodeByCode(code);
          if (!existing) break;
          code = "";
        }
        if (!code) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not allocate a unique code" });

        const codeExpiresAt = new Date(Date.now() + input.codeValidDays * 24 * 60 * 60 * 1000);
        const row = await db.createActivationCode({
          code,
          tier: input.tier,
          durationMonths: input.durationMonths,
          amountUgx: input.amountUgx ?? null,
          payerPhone: input.payerPhone?.trim() || null,
          note: input.note?.trim() || null,
          createdByUserId: ctx.user.id,
          codeExpiresAt,
        });

        await db.logActivity({
          clinicId: ctx.user.clinicId ?? 0,
          userId: ctx.user.id,
          action: "ADMIN_GENERATE_ACTIVATION_CODE",
          entityType: "activation_code",
          entityId: row.id,
          changes: JSON.stringify({
            code,
            tier: input.tier,
            durationMonths: input.durationMonths,
            payerPhone: input.payerPhone,
            amountUgx: input.amountUgx,
          }),
        });

        return {
          id: row.id,
          code,
          tier: input.tier,
          durationMonths: input.durationMonths,
          codeExpiresAt,
        } as const;
      }),

    listActivationCodes: ownerProcedure.query(() => db.listActivationCodes(150)),

    revokeActivationCode: ownerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.revokeActivationCode(input.id);
        await db.logActivity({
          clinicId: ctx.user.clinicId ?? 0,
          userId: ctx.user.id,
          action: "ADMIN_REVOKE_ACTIVATION_CODE",
          entityType: "activation_code",
          entityId: input.id,
        });
        return { success: true } as const;
      }),

    triggerBackup: ownerProcedure.mutation(async ({ ctx }) => {
      const result = await runFullBackup();
      await db.logActivity({
        clinicId: ctx.user.clinicId ?? 0,
        userId: ctx.user.id,
        action: "ADMIN_TRIGGER_BACKUP",
        entityType: "system",
        changes: JSON.stringify(result),
      });
      return result;
    }),

    // Gap #9: reach a clinic without leaving the product. Reuses the same
    // sendEmail/sendSMS infra clinics themselves use for reminders.
    messageClinic: ownerProcedure
      .input(z.object({
        clinicId: z.number(),
        subject: z.string().min(1).max(200),
        message: z.string().min(1).max(2000),
        channel: z.enum(["email", "sms", "both"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const clinic = await db.getClinicById(input.clinicId);
        if (!clinic) throw new TRPCError({ code: "NOT_FOUND" });
        const results: { email?: boolean; sms?: boolean } = {};
        if ((input.channel === "email" || input.channel === "both") && clinic.email) {
          const sent = await sendEmail({
            to: clinic.email,
            subject: input.subject,
            html: `<p>${escapeHtml(input.message).replace(/\n/g, "<br/>")}</p><p style="color:#888;font-size:12px;margin-top:24px;">— The CareDesk team</p>`,
          });
          results.email = sent.status === "sent";
        }
        if ((input.channel === "sms" || input.channel === "both") && clinic.phone) {
          const sent = await sendSMS(clinic.phone, input.message, countryToDialCode(clinic.country));
          results.sms = sent.status === "sent";
        }
        await db.logActivity({
          clinicId: input.clinicId,
          userId: ctx.user.id,
          action: "ADMIN_MESSAGE_CLINIC",
          entityType: "clinic",
          entityId: input.clinicId,
          changes: JSON.stringify({ subject: input.subject, channel: input.channel }),
        });
        return { success: true, ...results } as const;
      }),

    impersonate: ownerProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const target = await db.getUserById(input.userId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        if (target.role === "admin") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot impersonate another admin" });
        }
        // Store the admin's own ID in the session so they can exit impersonation later.
        await setSessionCookie(ctx.req, ctx.res, input.userId, false, ctx.user.id);
        if (target.clinicId) {
          await db.logActivity({
            clinicId: target.clinicId,
            userId: ctx.user.id,
            action: "ADMIN_IMPERSONATE_START",
            entityType: "user",
            entityId: target.id,
            changes: JSON.stringify({ targetName: target.name, targetRole: target.role }),
          });
        }
        return { success: true, targetName: target.name, targetRole: target.role } as const;
      }),

    exitImpersonation: protectedProcedure
      .mutation(async ({ ctx }) => {
        // The impersonation cookie stores the original admin's ID.
        // Restore it so the admin is back in their own session.
        const adminId = ctx.user.impersonatedBy;
        if (!adminId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Not currently impersonating" });
        }
        const admin = await db.getUserById(adminId);
        if (!admin || admin.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Original admin account not found" });
        }
        if (ctx.user.clinicId) {
          await db.logActivity({
            clinicId: ctx.user.clinicId,
            userId: adminId,
            action: "ADMIN_IMPERSONATE_END",
            entityType: "user",
            entityId: ctx.user.id,
            changes: null,
          });
        }
        await setSessionCookie(ctx.req, ctx.res, adminId, false);
        return { success: true } as const;
      }),
  }),

  dashboard: router({
    getTodayStats: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      return await db.getTodayStats(ctx.user.clinicId);
    }),

    getRevenueReport: protectedProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        // Full clinic revenue/collection-rate is manager-level financial data —
        // getDoctorPerformance and getSmsLog/getActivityLog already restrict to
        // manager/admin; this endpoint was missing the same check, so any
        // receptionist or doctor on a paid tier could pull the whole clinic's
        // financial picture just by hitting the Reports page.
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        if (!getClinicTierLimits(tier).reports) {
          throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:reports:clinic" });
        }
        const data = await db.getRevenueByDateRange(
          ctx.user.clinicId,
          new Date(input.startDate),
          new Date(`${input.endDate}T23:59:59`)
        );
        // Enrich with payment-method breakdown from the bills
        const paidBills = data.bills.filter((b) => b.paymentStatus === "paid" || b.paymentStatus === "partial");
        const consultationRevenue = paidBills.reduce((s, b) => s + parseFloat(b.consultationFee?.toString() || "0"), 0);
        const labRevenue = paidBills.reduce((s, b) => s + parseFloat(b.labTotal?.toString() || "0"), 0);
        const drugRevenue = paidBills.reduce((s, b) => s + parseFloat(b.drugTotal?.toString() || "0"), 0);
        const collectionRate = data.bills.length > 0
          ? Math.round((data.totalRevenue / data.bills.reduce((s, b) => s + parseFloat(b.grandTotal?.toString() || "0"), 0)) * 100)
          : 0;
        return {
          ...data,
          consultationRevenue,
          labRevenue,
          drugRevenue,
          collectionRate,
          totalBills: data.bills.length,
          paidBills: data.bills.filter((b) => b.paymentStatus === "paid").length,
        };
      }),

    getFollowUps: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
      return await db.getPendingFollowUps(ctx.user.clinicId);
    }),

    getDoctorPerformance: protectedProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.user.clinicId) throw new TRPCError({ code: "FORBIDDEN" });
        if (ctx.user.role !== "manager" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const clinic = ctx.clinic;
        const tier = getEffectiveTier(clinic as any);
        if (!getClinicTierLimits(tier).reports) {
          throw new TRPCError({ code: "FORBIDDEN", message: "TIER_LIMIT_FEATURE:reports:clinic" });
        }
        return await db.getDoctorPerformance(
          ctx.user.clinicId,
          new Date(input.startDate),
          new Date(`${input.endDate}T23:59:59`)
        );
      }),
  }),
});

export type AppRouter = typeof appRouter;
