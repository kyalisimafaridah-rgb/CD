# CareDesk MoMo Relay

Small standalone Android app. Its only job: watch for incoming MTN
MobileMoney / Airtel Money "received" SMS on one phone, and forward the raw
text to the CareDesk backend so subscription payments can be auto-approved
instead of requiring a manual admin click.

This is a **separate app**, not part of the CareDesk web bundle — a browser
has no API to read SMS, so this has to be a native install on the phone
that receives your MoMo payment notifications.

## How it fits together

```
Clinic manager pays via *165# (own phone, NOT a MoMo agent)
        │  reason field = their CareDesk clinic name
        ▼
Your phone receives "You have received UGX ... Reason: <clinic name>, ..."
        │
        ▼  (this app)
SmsReceiver → RelayForegroundService → POST /api/webhooks/momo-sms
        │
        ▼
server/momo-sms.ts: parse → match to a pending subscriptionPaymentRequest
by amount + clinic name in Reason → auto-approve (same code path as the
admin's manual "approve" click)
```

Anything that doesn't parse, doesn't match, or matches more than one
pending request lands in `admin.listMomoSmsEvents` (Owner Dashboard) for a
human to sort out — nothing is silently dropped.

## 1. Backend setup (do this first)

1. Set `MOMO_SMS_WEBHOOK_SECRET` in Render env vars — any long random
   string, e.g. `openssl rand -hex 32`. The webhook rejects everything
   until this is set (fail-safe, same pattern as `BACKUP_CRON_SECRET`).
2. `pnpm db:push` to create the `momoSmsEvents` table.
3. Confirm `POST https://<your-app>.onrender.com/api/webhooks/momo-sms`
   returns `401` with no header and `503` if the secret isn't set yet —
   that confirms the route is live before you wire up the phone.
4. **Tell every clinic manager (in the Settings upgrade instructions) to
   pay from their own phone via `*165#` or the MoMo app — never through an
   agent.** Agent-routed payments don't carry a usable Reason field, so
   auto-approval silently falls back to "no_match" and still needs your
   manual click. This is a business-process requirement, not just a
   technical detail — put it in the actual on-screen payment instructions.

## 2. Phone app setup

This phone should be the one whose SIM receives your MTN/Airtel MoMo
notifications — ideally a dedicated phone, so a personal phone getting
reset/repaired/sold doesn't quietly kill your billing automation.

1. Open this project in Android Studio, or build from CLI:
   ```
   cd android-relay
   ./gradlew assembleRelease
   ```
   (You'll need to run `gradle wrapper` once, or open in Android Studio
   which generates the wrapper for you — this scaffold ships the Gradle
   config but not the wrapper jar.)
2. Install the APK on the relay phone.
3. Open the app:
   - Enter the webhook URL: `https://<your-app>.onrender.com/api/webhooks/momo-sms`
   - Enter the same secret you set as `MOMO_SMS_WEBHOOK_SECRET`
   - Tap **Save**
   - Grant SMS permission when prompted
   - Tap **Fix** next to battery optimization — without this, Android will
     eventually kill the relay in the background and payments stop being
     auto-confirmed with no obvious symptom until you notice a clinic
     wasn't upgraded
4. Send a small test payment to that phone and confirm it shows up as
   "✅ Forwarded" in the app's Recent Activity list, and as a row in
   Owner Dashboard → Billing → MoMo SMS Events.

## Known limitations (v1)

- **Single point of failure.** If this phone loses signal, dies, or gets
  factory reset, payments stop auto-confirming. The manual "approve"
  button in Owner Dashboard still works as a fallback at all times —
  this app only removes the need to use it, it doesn't replace it.
- **Airtel-received SMS parsing is a best-effort placeholder** in
  `server/momo-sms.ts` (`AIRTEL_RECEIVED_RE`) — it hasn't been confirmed
  against a real Airtel-originated "you have received" SMS the way the
  MTN format has. Send a test payment from an Airtel line and check
  Owner Dashboard for a `parse_failed` row; if you see one, share the raw
  SMS text so the regex can be corrected.
- **Reference-based matching only works when the payer types a reference**
  (self-service `*165#`/app send, not agent). This is a real MTN/Airtel
  platform constraint, not something the code can work around.
