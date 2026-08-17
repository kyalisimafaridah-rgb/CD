export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  atApiKey: process.env.AT_API_KEY ?? "",
  atUsername: process.env.AT_USERNAME ?? "",
  isProduction: process.env.NODE_ENV === "production",

  // Platform owner's login email. Gates the /owner dashboard and admin.*
  // router — separate from the per-clinic "admin" role (which every
  // clinic's first registered user automatically receives). Without this
  // check, any clinic's first user could see and modify every other
  // clinic's data via the owner dashboard.
  ownerEmail: process.env.OWNER_EMAIL ?? "",

  // Manus "forge" proxy - still used by server/_core/notification.ts
  // (notifyOwner). Unrelated to file storage (see R2 vars below).
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",

  // Public base URL of this app, used to build links in emails
  // (e.g. staff invite links, password reset links).
  appUrl: process.env.APP_URL ?? "",

  // Cloudflare R2 (S3-compatible) file storage - see server/storage.ts
  r2AccountId: process.env.CF_ACCOUNT_ID ?? "",
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  r2Bucket: process.env.R2_BUCKET_NAME ?? "",
  r2PublicUrl: process.env.R2_PUBLIC_URL ?? "",

  // Resend transactional email - see server/email.ts
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "CareDesk <onboarding@resend.dev>",

  // Lemonsqueezy subscription billing - see server/_core/lemonsqueezy.ts
  lemonSqueezyApiKey: process.env.LEMON_SQUEEZY_API_KEY ?? "",
  lemonSqueezyWebhookSecret: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET ?? "",
  // Lemonsqueezy variant IDs for each paid tier.
  // Set these in Render env vars to match the variant IDs in your LS store.
  // e.g. LEMON_VARIANT_CLINIC=123456, LEMON_VARIANT_PRO=789012
  lemonVariantClinic: process.env.LEMON_VARIANT_CLINIC ?? "",
  lemonVariantPro: process.env.LEMON_VARIANT_PRO ?? "",
  // Your Lemonsqueezy store slug (appears in checkout URLs)
  lemonStoreSlug: process.env.LEMON_STORE_SLUG ?? "",

  // Subscription enforcement is dormant by default. Trials are tracked
  // (trialEndsAt is set on registration) but do NOT block access until
  // this is explicitly set to "true". Manual suspension via the owner
  // dashboard (subscriptionStatus = 'suspended') is enforced regardless
  // of this flag.
  enforceTrialExpiry: process.env.ENFORCE_TRIAL_EXPIRY === "true",

  // Sentry error monitoring — set SENTRY_DSN in Render env vars.
  // Free tier covers 5k errors/month which is plenty for early stage.
  // Get your DSN at sentry.io after creating a Node.js project.
  sentryDsn: process.env.SENTRY_DSN ?? "",

  // Shared secret an external cron (Render Cron Job, GitHub Actions
  // scheduled workflow, cron-job.org, etc.) must send to trigger
  // system.runScheduledBackup — see server/backup.ts. Unset means that
  // public endpoint always rejects, so backups only run via the manual
  // admin.triggerBackup button until this is configured.
  backupCronSecret: process.env.BACKUP_CRON_SECRET ?? "",
};
