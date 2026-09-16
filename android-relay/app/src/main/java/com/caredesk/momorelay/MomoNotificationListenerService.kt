package com.caredesk.momorelay

import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * Second, independent sensor for the same event SmsReceiver already
 * catches. Some OEM battery managers (MIUI, some Huawei/Honor builds, a
 * few Oppo/Vivo skins) are aggressive enough to silently drop SMS
 * broadcasts to background apps even with battery-optimization exemption
 * granted — but the MoMo app's own notification sometimes survives when
 * the SMS broadcast doesn't, because Android treats "another app posted a
 * notification" and "an SMS broadcast arrived" as different code paths
 * with different OEM interception points.
 *
 * This does NOT replace SmsReceiver — it's a second chance at catching
 * the same payment. Both paths funnel into the same
 * RelayForegroundService → webhook → server-side dedup (unique index on
 * momoSmsEvents.transactionId), so if both the SMS and the notification
 * for the same payment get through, the server collapses them into one
 * event automatically. No double-approval risk from running both.
 *
 * SETUP NOTE — this permission can't be requested with a normal runtime
 * dialog like RECEIVE_SMS. The user has to grant "Notification access"
 * manually in Settings (MainActivity links there — see
 * requestNotificationAccess()). Nothing here fires until that's granted.
 *
 * PACKAGE NAMES — MOMO_PACKAGE_HINTS below are best-guess MTN/Airtel app
 * IDs and have NOT been confirmed against real installs. Before relying
 * on this, check the actual package name of whichever MoMo app is on the
 * relay phone: Settings → Apps → (the app) → Advanced → shows the package
 * ID, or `adb shell pm list packages | grep -i mtn` / `airtel`. Update
 * MOMO_PACKAGE_HINTS to match. Until then, the body-text fallback below
 * (looksLikeMomo) still catches it even if the package match misses —
 * package filtering is an optimization, not the only gate.
 */
class MomoNotificationListenerService : NotificationListenerService() {

    companion object {
        private const val TAG = "MomoNotifListener"
        private val MOMO_PACKAGE_HINTS = listOf(
            "com.mtn.momo", "com.mtn.mymtn", "com.mtn.ug",
            "com.airtel.money", "com.airtel.africa", "africa.airtel.money"
        )
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: ""
        val extras = sbn.notification?.extras ?: return
        val text = (extras.getCharSequence(android.app.Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(android.app.Notification.EXTRA_TEXT)
            ?: "").toString()
        if (text.isBlank()) return

        val pkgLower = pkg.lowercase()
        val textLower = text.lowercase()
        val packageMatches = MOMO_PACKAGE_HINTS.any { pkgLower.contains(it) }
        val looksLikeMomo = packageMatches ||
            textLower.contains("you have received ugx") ||
            (textLower.contains("momo") && textLower.contains("ugx"))

        Log.i(TAG, "Notification from '$pkg' — looksLikeMomo=$looksLikeMomo")
        // Reuse the same debug log SmsReceiver writes to, tagged so
        // MainActivity's activity list makes the source obvious.
        RelayLog.record(applicationContext, "notif:$pkg", text, forwarded = looksLikeMomo)

        if (!looksLikeMomo) return

        val network = if (pkgLower.contains("airtel") || textLower.contains("airtel")) "airtel" else "mtn"

        // Same downstream pipeline SmsReceiver uses — one webhook, one
        // dedup key, no special-casing needed on the server for this to
        // be safe to run alongside the SMS path.
        val serviceIntent = Intent(this, RelayForegroundService::class.java).apply {
            action = RelayForegroundService.ACTION_RELAY_SMS
            putExtra(RelayForegroundService.EXTRA_SENDER, "notif:$pkg")
            putExtra(RelayForegroundService.EXTRA_BODY, text)
            putExtra(RelayForegroundService.EXTRA_NETWORK, network)
        }
        RelayForegroundService.enqueueWork(applicationContext, serviceIntent)
    }
}
